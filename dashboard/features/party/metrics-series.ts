import { METRIC_RESET_KINDS, type MetricsResponse, type MetricTotals, type MetricResetKind, type MetricResets } from '../../../runtime/metrics/contracts.ts';

export interface GraphPoint { at: number; [key: string]: number | null }
export interface GraphSeries { key: string; label: string; color: string; dash?: string }
export const METRIC_COLORS = ['#22d3ee', '#fbbf24', '#fb7185', '#a78bfa', '#4ade80', '#fb923c', '#60a5fa', '#e879f9'];
export const characterSeries = (names: string[], roster = names): GraphSeries[] => names.map(name => ({ key: 'character:' + name, label: name, color: METRIC_COLORS[Math.max(0, roster.indexOf(name)) % METRIC_COLORS.length] }));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
export function selectMetricRows(rows: MetricTotals[], characters: string[], server: string) {
  return rows.filter(row => (!characters.length || characters.includes(row.character)) && (!server || row.server === server));
}
/** Missing ping observations remain gaps rather than zero-latency samples. */
export function pingGraph(data: MetricsResponse, filters: { characters: string[]; server: string }) {
  const names = filters.characters;
  const series = characterSeries(names, data.characters);
  const ping: GraphPoint[] = [];
  const points = new Map(data.points.map(point => [point.at, point]));
  const resetAt = data.resets?.ping || 0;
  for (let at = Math.floor(data.from / data.resolutionMs) * data.resolutionMs; at < data.to; at += data.resolutionMs) {
    if (at + data.resolutionMs <= resetAt) continue;
    const selected = selectMetricRows(points.get(at)?.values || [], names, filters.server).filter(row => row.last.at >= resetAt);
    const point: GraphPoint = { at: Math.max(at, resetAt) };
    for (const line of series) {
      const rows = selected.filter(row => row.character === line.label);
      const samples = sum(rows.map(row => row.pingSamples));
      point[line.key] = samples ? sum(rows.map(row => row.pingSum)) / samples : null;
    }
    ping.push(point);
  }
  return { series, ping };
}
export interface TemporaryMetricReset { at: number; bucketAt: number; resolutionMs: number; values: MetricTotals[] }
export function applyAcknowledgedResets(data: MetricsResponse, acknowledged: MetricResets): MetricsResponse {
  const kills = (data.resets?.kills || 0) < (acknowledged.kills || 0), damage = (data.resets?.damage || 0) < (acknowledged.damage || 0);
  if (!kills && !damage) return data;
  const cuts = { ...data.resets };
  for (const kind of METRIC_RESET_KINDS) if (acknowledged[kind] !== undefined) cuts[kind] = Math.max(cuts[kind] || 0, acknowledged[kind] || 0);
  return { ...data, resets: cuts, points: data.points.map(point => ({
    ...point, kills: kills ? [] : point.kills,
    values: point.values.map(row => ({ ...row, credits: kills ? [] : row.credits, damage: damage ? [] : row.damage })),
  })) };
}
/** A display reset subtracts the last received partial bucket. Stored measurements
 * remain untouched and can be restored with Reset filters.
 */
export function applyTemporaryResets(data: MetricsResponse, resets: Partial<Record<MetricResetKind, TemporaryMetricReset>>): MetricsResponse {
  const cuts = { ...data.resets };
  for (const kind of ['gold', 'loot', 'ping'] as const) if (resets[kind]) cuts[kind] = Math.max(cuts[kind] || 0, resets[kind].at);
  const points = data.points.map(point => ({ ...point, values: point.values.map(row => {
    let result = row;
    for (const kind of ['loot', 'ping'] as const) {
      const reset = resets[kind];
      if (!reset || point.at >= reset.at) continue;
      if (point.at + data.resolutionMs <= reset.at || data.resolutionMs !== reset.resolutionMs) {
        result = kind === 'loot' ? { ...result, loot: [] } : { ...result, pingSum: 0, pingSamples: 0 };
        continue;
      }
      if (point.at !== reset.bucketAt) continue;
      const baseline = reset.values.find(value => value.character === row.character && value.server === row.server);
      if (!baseline) continue;
      result = { ...result };
      if (kind === 'loot') result.loot = row.loot.map(item => ({ ...item, quantity: Math.max(0, item.quantity - (baseline.loot.find(previous => previous.item === item.item && previous.variant === item.variant)?.quantity || 0)) })).filter(item => item.quantity > 0);
      else {
        result.pingSum = Math.max(0, row.pingSum - baseline.pingSum);
        result.pingSamples = Math.max(0, row.pingSamples - baseline.pingSamples);
      }
    }
    return result;
  }) }));
  return { ...data, resets: cuts, points };
}
export function observedMonsterRate(data: MetricsResponse, monster: string, server: string, characters: string[]) {
  const count = sum(data.points.flatMap(point => point.kills).filter(kill => (!server || kill.server === server) && kill.monster === monster && (!characters.length || characters.includes(kill.actor))).map(kill => kill.count));
  const elapsed = data.to - Math.max(data.from, data.startedAt, data.resets?.kills || 0);
  return elapsed > 0 && count > 0 ? count * 3_600_000 / elapsed : null;
}
