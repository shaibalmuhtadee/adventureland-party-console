import { mkdir, readFile, writeFile, rename, readdir, lstat, unlink, rmdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const RETAIN_BUILDS = 20;
export async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = file + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}
export async function withBuildLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  await mkdir(directory, {recursive: true});
  const lock = path.join(directory, 'operation.lock');
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await reclaimStaleLock(lock)) {
      try { await mkdir(lock); }
      catch (retry) {
        if ((retry as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Error('Build store is locked: ' + lock + '. Retry after the active operation finishes.');
        throw retry;
      }
    } else {
      throw new Error('Build store is locked: ' + lock + '. Retry after the active operation finishes.');
    }
  }
  try {
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}));
    return await action();
  } finally { await unlink(path.join(lock, 'owner.json')).catch(() => {}); await rmdir(lock); }
}
// A crashed process can leave operation.lock behind. Reclaim it only when its
// recorded owner is provably dead (process.kill(pid, 0) reports ESRCH), never
// based on age alone. The stale directory is moved aside atomically so two
// reclaimers cannot both claim the lock, and a changed owner aborts the
// reclaim instead of deleting a live lock.
async function reclaimStaleLock(lock: string): Promise<boolean> {
  let owner: {pid: unknown} | undefined;
  try { owner = await readJson<{pid: unknown}>(path.join(lock, 'owner.json')); }
  catch { return false; }
  if (!isLockPid(owner?.pid)) {
    // Another process may have acquired the lock but not recorded ownership
    // yet, so give it time to appear before treating the lock as stale.
    await new Promise(resolve => setTimeout(resolve, 1000));
    try { owner = await readJson<{pid: unknown}>(path.join(lock, 'owner.json')); }
    catch { return false; }
  }
  const pid = owner?.pid;
  if (!isLockPid(pid)) return takeStaleLock(lock, undefined);
  try { process.kill(pid, 0); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
    return takeStaleLock(lock, pid);
  }
}
function isLockPid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}
async function takeStaleLock(lock: string, expectedPid: number | undefined): Promise<boolean> {
  const stale = lock + '.stale.' + randomUUID();
  try { await rename(lock, stale); }
  catch { return false; }
  let current: {pid: unknown} | undefined;
  try { current = await readJson<{pid: unknown}>(path.join(stale, 'owner.json')); }
  catch { await rename(stale, lock).catch(() => {}); return false; }
  if (current?.pid !== expectedPid) {
    await rename(stale, lock).catch(() => {});
    return false;
  }
  await unlink(path.join(stale, 'owner.json')).catch(() => {});
  await rmdir(stale).catch(() => {});
  return true;
}
export interface Removal { path: string; bytes: number }
// Inspect every component and descendant before deleting. Never follow a junction
// or symlink, and never remove the root itself. Unknown files are selected by callers.
export async function inspectRemoval(root: string, relative: string): Promise<Removal> {
  const base = path.resolve(root), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error('Cleanup escaped its root: ' + target);
  // path.relative respects Windows casing while still detecting redirected roots.
  if (path.relative(base, await realpath(base)) !== '') throw new Error('Cleanup root is redirected: ' + base);
  let current = base;
  for (const component of path.relative(base, target).split(path.sep)) {
    current = path.join(current, component);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Cleanup refuses links: ' + current);
  }
  return {path: target, bytes: await treeBytes(target)};
}
async function treeBytes(file: string): Promise<number> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error('Cleanup refuses links: ' + file);
  if (!info.isDirectory()) return info.size;
  let bytes = 0;
  for (const name of await readdir(file)) bytes += await treeBytes(path.join(file, name));
  return bytes;
}
async function deleteTree(file: string): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error('Cleanup refuses links: ' + file);
  if (!info.isDirectory()) { await unlink(file); return; }
  for (const name of await readdir(file)) await deleteTree(path.join(file, name));
  await rmdir(file);
}
export async function applyRemovals(root: string, removals: Removal[]): Promise<void> {
  for (const removal of removals) {
    const verified = await inspectRemoval(root, path.relative(root, removal.path));
    await deleteTree(verified.path);
  }
}
export async function directoryNames(directory: string): Promise<string[]> {
  try { return await readdir(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
