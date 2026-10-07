import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  ".build",
  "outputs",
  "work",
]);

export async function fingerprint(directory: string, externalDirectories: readonly string[] = []): Promise<string> {
  const hash = createHash("sha256").update(process.version);
  async function visit(base: string, relative: string, prefix: string): Promise<void> {
    const entries = await readdir(path.join(base, relative), { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (
        ignored.has(entry.name) ||
        entry.name.endsWith(".tsbuildinfo") ||
        entry.name.endsWith(".log")
      )
        continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(base, name, prefix);
      else if (entry.isFile()) hash.update(path.join(prefix, name)).update(await readFile(path.join(base, name)));
    }
  }
  await visit(directory, "", "");
  for (const dependency of [...externalDirectories].sort())
    await visit(path.resolve(directory, dependency), "", dependency);
  return hash.digest("hex").slice(0, 20);
}
