import { METRIC_RESET_KINDS, type MetricResets, type MetricCredit, type MetricDamage, type MetricFrame, type MetricKill, type MetricLoot, type MetricSample } from './contracts.ts';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function object(value: unknown): Record<string, unknown> | null {
  return isObject(value) ? value : null;
}
export function metricNumber(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}
export function metricText(value: unknown, maximum = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}
export function parseMetricResets(value: unknown): MetricResets | null {
  const row = object(value);
  if (!row) return null;
  const resets: MetricResets = {};
  for (const kind of METRIC_RESET_KINDS) {
    const at = row[kind];
    if (at === undefined) continue;
    if (!metricNumber(at)) return null;
    resets[kind] = at;
  }
  return resets;
}
export function parseMetricSample(value: unknown): MetricSample | null {
  const row = object(value);
  if (!row || !metricNumber(row.at) || !metricNumber(row.gold) || !metricNumber(row.luck, 0, 1000) ||
      !(row.ping === null || metricNumber(row.ping)) || !metricNumber(row.level, 1, 1000) ||
      !metricNumber(row.xp) || !metricNumber(row.maxXp) ||
      !(row.goldMovement === undefined || metricNumber(row.goldMovement, -Number.MAX_SAFE_INTEGER)) ||
      !(row.encouragementLuck === undefined || metricNumber(row.encouragementLuck, 1, 1000))) return null;
  return { at: row.at, gold: row.gold, luck: row.luck, ping: row.ping, level: row.level, xp: row.xp, maxXp: row.maxXp,
    ...(row.goldMovement === undefined ? {} : { goldMovement: row.goldMovement }),
    ...(row.encouragementLuck === undefined ? {} : { encouragementLuck: row.encouragementLuck }) };
}
function damage(value: unknown): MetricDamage | null {
  const row = object(value);
  if (!row || !metricText(row.monster) || !metricText(row.skill) || !metricNumber(row.amount) || !metricNumber(row.hits)) return null;
  return { monster: row.monster, skill: row.skill, amount: row.amount, hits: row.hits };
}
function credit(value: unknown): MetricCredit | null {
  const row = object(value);
  if (!row || !metricText(row.monster) || !metricNumber(row.count, 1)) return null;
  return { monster: row.monster, count: row.count };
}
function kill(value: unknown): MetricKill | null {
  const row = object(value);
  if (!row || !metricText(row.id, 500) || !metricNumber(row.at) || !metricText(row.monster) || !metricText(row.actor)) return null;
  return { id: row.id, at: row.at, monster: row.monster, actor: row.actor };
}
function loot(value: unknown): MetricLoot | null {
  const row = object(value);
  if (!row || !metricText(row.id, 500) || !metricNumber(row.at) || !metricText(row.item) ||
      !metricText(row.variant, 500) || !metricNumber(row.quantity, 1)) return null;
  return { id: row.id, at: row.at, item: row.item, variant: row.variant, quantity: row.quantity };
}
function list<T>(value: unknown, limit: number, parse: (value: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result: T[] = [];
  for (const row of value) { const parsed = parse(row); if (!parsed) return null; result.push(parsed); }
  return result;
}
export function parseMetricFrame(value: unknown): MetricFrame | null {
  const row = object(value);
  if (!row || !metricNumber(row.at) || !metricNumber(row.sequence, 1) || !Number.isSafeInteger(row.sequence) ||
      !metricNumber(row.observedMs, 0, 10_000) || typeof row.partial !== 'boolean') return null;
  const at = row.at;
  const first = parseMetricSample(row.first), last = parseMetricSample(row.last),
    hits = list(row.damage, 128, damage), credits = list(row.credits, 128, credit), kills = list(row.kills, 256, kill), items = list(row.loot, 256, loot);
  if (!first || !last || !hits || !credits || !kills || !items || first.at < at || last.at < first.at || last.at > at + 10_000 ||
      kills.some(value => value.at < at || value.at >= at + 10_000) ||
      items.some(value => value.at < at || value.at >= at + 10_000)) return null;
  return { at, sequence: row.sequence, observedMs: row.observedMs, partial: row.partial,
    first, last, damage: hits, credits, kills, loot: items };
}
