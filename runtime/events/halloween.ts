import type { SEventsInfos, SMonsterEventLiveWithCoordinates } from 'typed-adventureland';

export const halloweenBosses = ['mrpumpkin', 'mrgreen'] as const satisfies readonly (keyof SEventsInfos)[];
export type HalloweenBoss = (typeof halloweenBosses)[number];
// Native map IDs can outpace the installed game's type catalog. This is a
// validated observation envelope, not a complete upstream monster object.
export type HalloweenEncounter = Omit<Pick<SMonsterEventLiveWithCoordinates,
  'map' | 'x' | 'y' | 'hp' | 'max_hp' | 'target'>, 'map'> & { map: string; type: HalloweenBoss };
export type HalloweenSpawn = Pick<HalloweenEncounter, 'type' | 'map' | 'x' | 'y'> & { spawnAt: number };
export const halloweenPreparationMs = 120000;
export const halloweenSpawnGraceMs = 30000;
/** Clock-offset estimates fluctuate between heartbeats without rescheduling a spawn. */
export function sameHalloweenSpawn(first: HalloweenSpawn, second: HalloweenSpawn): boolean {
  return first.type === second.type && first.map === second.map &&
    Math.abs(first.spawnAt - second.spawnAt) <= 1000 && Math.hypot(first.x - second.x, first.y - second.y) <= 1;
}
export interface HalloweenObservation {
  season: boolean;
  feedAt: number;
  bosses: HalloweenEncounter[];
  next?: number;
  // Older character reports contain only the earliest timestamp.
  upcoming?: HalloweenSpawn[];
}
interface AttendanceOwner { source: string; realm: string; generation: number }
export type HalloweenAttendance = AttendanceOwner & (
  { phase: 'idle' | 'waiting' } |
  { phase: 'preparing'; encounter: HalloweenSpawn } |
  { phase: 'attending'; encounter: HalloweenEncounter; lastLiveAt: number }
);
export type HalloweenAttendanceReport = HalloweenAttendance & { validUntil: number };
function readOwner(value: unknown) {
  const entry = object(value);
  if (!entry || typeof entry.source !== 'string' || typeof entry.realm !== 'string' ||
      !finite(entry.generation) || !finite(entry.validUntil)) return null;
  return { source: entry.source, realm: entry.realm, generation: entry.generation, validUntil: entry.validUntil };
}
export function readHalloweenAttendance(value: unknown): HalloweenAttendanceReport | null {
  const entry = object(value), owner = readOwner(value);
  if (!entry || !owner) return null;
  if (entry.phase === 'idle' || entry.phase === 'waiting') return { ...owner, phase: entry.phase };
  if (entry.phase === 'preparing') {
    const encounter = readHalloweenSpawn(entry.encounter);
    return encounter ? {...owner, phase: 'preparing', encounter} : null;
  }
  const encounter = readHalloweenEncounter(entry.encounter);
  return entry.phase === 'attending' && encounter && finite(entry.lastLiveAt)
    ? { ...owner, phase: 'attending', encounter, lastLiveAt: entry.lastLiveAt } : null;
}
export function restoreHalloweenAttendance(value: unknown): Record<string, HalloweenAttendance> {
  const result: Record<string, HalloweenAttendance> = {};
  for (const [key, entry] of Object.entries(object(value) || {})) {
    const saved = readHalloweenAttendance({ ...object(entry), validUntil: 0 });
    if (saved) { const { validUntil: _expired, ...attendance } = saved; result[key] = attendance; }
  }
  return result;
}
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
export function isHalloweenBoss(value: unknown): value is HalloweenBoss {
  return value === 'mrpumpkin' || value === 'mrgreen';
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export function readHalloweenEncounter(value: unknown): HalloweenEncounter | null {
  const entry = object(value);
  if (!entry || !isHalloweenBoss(entry.type)) return null;
  const point = readPoint(entry), health = readHealth(entry);
  if (!point || !health) return null;
  return { type: entry.type, ...point, ...health, target: typeof entry.target === 'string' ? entry.target : null };
}
export function readHalloweenSpawn(value: unknown): HalloweenSpawn | null {
  const entry = object(value), point = entry && readPoint(entry);
  return entry && point && isHalloweenBoss(entry.type) && finite(entry.spawnAt) && entry.spawnAt > 0
    ? {...point, type: entry.type, spawnAt: entry.spawnAt} : null;
}
function readPoint(entry: Record<string, unknown>) {
  if (typeof entry.map !== 'string' || !entry.map || !finite(entry.x) || !finite(entry.y)) return null;
  return { map: entry.map, x: entry.x, y: entry.y };
}
function readHealth(entry: Record<string, unknown>) {
  if (!finite(entry.hp) || entry.hp <= 0 || !finite(entry.max_hp) || entry.max_hp <= 0) return null;
  return { hp: entry.hp, max_hp: entry.max_hp };
}
export function readHalloweenObservation(value: unknown): HalloweenObservation | null {
  const entry = object(value);
  if (!entry || typeof entry.season !== 'boolean' || !finite(entry.feedAt) || !Array.isArray(entry.bosses)) return null;
  const bosses = entry.bosses.slice(0, 2).map(readHalloweenEncounter)
    .filter((boss): boss is HalloweenEncounter => boss !== null);
  const upcoming = Array.isArray(entry.upcoming) ? entry.upcoming.slice(0, 2).map(readHalloweenSpawn)
    .filter((spawn): spawn is HalloweenSpawn => spawn !== null) : [];
  return { season: entry.season, feedAt: entry.feedAt, bosses, upcoming,
    ...(finite(entry.next) && entry.next > 0 ? { next: entry.next } : {}) };
}
function timestamp(value: unknown): number | undefined {
  const epoch = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(epoch) && epoch > 0 ? (epoch < 1e12 ? epoch * 1000 : epoch) : undefined;
}
function spawnPoint(maps: Record<string, unknown>, type: HalloweenBoss) {
  for (const [map, value] of Object.entries(maps)) {
    const definition = object(value);
    if (!definition || definition.ignore || !Array.isArray(definition.monsters)) continue;
    for (const value of definition.monsters) {
      const point = spawnCenter(value, type);
      if (point) return { map, ...point };
    }
  }
  return null;
}
function spawnCenter(value: unknown, type: HalloweenBoss) {
  const spawn = object(value), bounds = spawn?.boundary || (spawn && Array.isArray(spawn.boundaries) ? spawn.boundaries[0] : null);
  if (spawn?.type !== type || !Array.isArray(bounds)) return null;
  const offset = typeof bounds[0] === 'string' ? 1 : 0;
  const [left, top, right, bottom] = bounds.slice(offset, offset + 4);
  if (![left, top, right, bottom].every(finite)) return null;
  return { x: (left + right) / 2, y: (top + bottom) / 2 };
}
function liveBoss(type: HalloweenBoss, boss: Record<string, unknown>, maps: Record<string, unknown>, monsters: Record<string, unknown>) {
  const reported = readPoint(boss);
  const point = reported && maps[reported.map] ? reported : spawnPoint(maps, type);
  const maximum = finite(boss.max_hp) && boss.max_hp > 0 ? boss.max_hp : object(monsters[type])?.hp;
  return point ? readHalloweenEncounter({ ...boss, ...point, type, max_hp: maximum }) : null;
}
function earlier(current: number | undefined, next: number | undefined) {
  if (!next) return current;
  return current ? Math.min(current, next) : next;
}
/** Raw season/boss reports are independent of opt-in and coordinator selection. */
export function observeHalloween(status: unknown, game: unknown, feedAt: number): HalloweenObservation {
  const feed = object(status) || {}, data = object(game) || {};
  const maps = object(data.maps) || {}, monsters = object(data.monsters) || {};
  const bosses: HalloweenEncounter[] = [];
  const upcoming: HalloweenSpawn[] = [];
  let next: number | undefined;
  for (const type of halloweenBosses) {
    const boss = object(feed[type]);
    if (!boss) continue;
    if (boss.live !== true) {
      const spawnAt = timestamp(boss.spawn || boss.next);
      next = earlier(next, spawnAt);
      const reported = readPoint(boss);
      const point = spawnPoint(maps, type) || (reported && maps[reported.map] ? reported : null);
      if (spawnAt && point) upcoming.push({...point, type, spawnAt});
      continue;
    }
    const encounter = liveBoss(type, boss, maps, monsters);
    if (encounter) bosses.push(encounter);
  }
  return { season: feed.halloween === true, feedAt, bosses, next, upcoming };
}
/** Keep preparation owned briefly past its deadline while the live report arrives. */
export function halloweenPreparation(observation: HalloweenObservation | null | undefined, now: number): HalloweenSpawn | null {
  if (!observation || now - observation.feedAt > 120000 || observation.feedAt > now + 5000) return null;
  return (observation.upcoming || []).filter(spawn => spawn.spawnAt - now <= halloweenPreparationMs &&
    now <= spawn.spawnAt + halloweenSpawnGraceMs)
    .sort((a, b) => a.spawnAt - b.spawnAt || a.type.localeCompare(b.type))[0] || null;
}
export function rankHalloweenBosses(bosses: readonly HalloweenEncounter[]): HalloweenEncounter[] {
  return [...bosses].sort((a, b) => a.hp / a.max_hp - b.hp / b.max_hp || a.type.localeCompare(b.type));
}
