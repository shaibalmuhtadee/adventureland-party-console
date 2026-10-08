import type { MetricTotals, MetricsBarsResponse, MetricBarSummary } from '../../metrics/contracts.ts';
import type { IndexedDamage, IndexedLoot } from './measurement-index.ts';

interface Bucket { at: number; width: number; values: MetricTotals[] }
interface Scope {
  from: number; to: number; now: number; startedAt: number; resetAt: number; dayFrom: number; dayTo: number;
  characters: string[]; servers: string[]; monsters: string[]; skills: string[]; items: string[];
}
type Query = Scope & ({ metric: 'damage'; by: 'character' | 'skill' } | { metric: 'loot'; by: 'item' });
interface Sources { range: Bucket[]; day: Bucket[]; damage: Iterable<IndexedDamage>; loot: Iterable<IndexedLoot>; lastReceivedAt: number | null }

/** Rates normalize the selected range. Daily and retained totals use their own
 * scopes, so shortening a chart range cannot shorten the daily counter.
 */
export function measurementSummary(query: Query, source: Sources): MetricsBarsResponse {
  const rows = new Map<string, MetricBarSummary>(), characters = new Set<string>(), monsters = new Set<string>(), skills = new Set<string>(), items = new Set<string>();
  const context = (row: Pick<MetricTotals, 'character' | 'server'>) => (!query.characters.length || query.characters.includes(row.character)) && (!query.servers.length || query.servers.includes(row.server));
  const wantedDamage = (hit: MetricTotals['damage'][number]) => (!query.monsters.length || query.monsters.includes(hit.monster)) && (!query.skills.length || query.skills.includes(hit.skill));
  const wantedItem = (item: MetricTotals['loot'][number]) => !query.items.length || query.items.includes(item.item);
  function add(id: string, amount: number, field: 'amount' | 'total' | 'today') {
    const row = rows.get(id) || { id, amount: 0, total: 0, today: 0 };
    row[field] += amount; rows.set(id, row);
  }
  if (query.metric === 'damage') {
    for (const hit of source.damage) {
      if (!context(hit)) continue;
      characters.add(hit.character); monsters.add(hit.monster); skills.add(hit.skill);
      if (wantedDamage(hit)) add(query.by === 'skill' ? hit.skill : hit.character, hit.amount, 'total');
    }
  } else {
    for (const item of source.loot) {
      if (!context(item)) continue;
      characters.add(item.character); items.add(item.item);
      if (wantedItem(item)) add(item.item, item.quantity, 'total');
    }
  }
  function aggregate(buckets: Bucket[], field: 'amount' | 'today') {
    for (const bucket of buckets) for (const row of bucket.values) {
      if (!context(row)) continue;
      if (query.metric === 'damage') {
        for (const hit of row.damage) if (wantedDamage(hit)) add(query.by === 'skill' ? hit.skill : row.character, hit.amount, field);
      } else for (const item of row.loot) if (wantedItem(item)) add(item.item, item.quantity, field);
    }
  }
  aggregate(source.range, 'amount'); aggregate(source.day, 'today');
  const from = source.range.reduce((start, bucket) => Math.min(start, bucket.at), query.from);
  const to = Math.min(query.now, source.range.reduce((end, bucket) => Math.max(end, bucket.at + bucket.width), query.to));
  const fields = { version: 1 as const, from, to, elapsedMs: Math.max(0, to - Math.max(from, query.startedAt, query.resetAt)),
    dayFrom: query.dayFrom, dayTo: query.dayTo, resetAt: query.resetAt, rows: [...rows.values()].sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id)),
    characters: [...characters].sort(), monsters: [...monsters].sort(), skills: [...skills].sort(), items: [...items].sort(), lastReceivedAt: source.lastReceivedAt };
  return query.metric === 'damage' ? { ...fields, metric: 'damage', by: query.by } : { ...fields, metric: 'loot', by: 'item' };
}
