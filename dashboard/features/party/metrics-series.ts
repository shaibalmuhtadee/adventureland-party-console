import { METRIC_RESET_KINDS, type MetricsResponse, type MetricTotals, type MetricResetKind, type MetricResets } from '../../../runtime/metrics/contracts.ts';

export interface GraphPoint { at: number; [key: string]: number | null }
export interface GraphSeries { key: string; label: string; color: string; dash?: string }
export const METRIC_COLORS = ['#22d3ee', '#fbbf24', '#fb7185', '#a78bfa', '#4ade80', '#fb923c', '#60a5fa', '#e879f9'];
export const characterSeries = (names: string[], roster = names): GraphSeries[] => names.map(name => ({ key: 'character:' + name, label: name, color: METRIC_COLORS[Math.max(0, roster.indexOf(name)) % METRIC_COLORS.length] }));
export interface MetricFilters {
  characters: string[]; server: string; monster: string; skill: string; item: string;
  loot: 'total' | 'interval'; gold: 'balance' | 'change';
  compare: boolean; smoothingMs: number;
}
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
export function selectMetricRows(rows: MetricTotals[], characters: string[], server: string) {
  return rows.filter(row => (!characters.length || characters.includes(row.character)) && (!server || row.server === server));
}
/** Raw rates and trailing averages remain separate. Missing telemetry is null. */
export function metricGraphs(data: MetricsResponse, filters: MetricFilters) {
  const names = filters.characters.length ? filters.characters : data.characters;
  const series = filters.compare ? characterSeries(names, data.characters) : [{ key: 'total', label: 'Tracked party', color: METRIC_COLORS[0] }];
  const damage: GraphPoint[] = [], gold: GraphPoint[] = [], loot: GraphPoint[] = [], ping: GraphPoint[] = [];
  const cumulativeLoot = new Map<string, number>(), baselines = new Map<string, number>();
  const starts = Math.floor(data.from / data.resolutionMs) * data.resolutionMs;
  const points = new Map(data.points.map(point => [point.at, point]));
  const reset = (kind: MetricResetKind) => data.resets?.[kind] || 0;
  for (let at = starts; at < data.to; at += data.resolutionMs) {
    const point = points.get(at), values = point?.values || [], selected = selectMetricRows(values, names, filters.server);
    const observedTo = Math.min(data.to, selected.reduce((latest, row) => Math.max(latest, row.last.at), at));
    const elapsed = (kind: MetricResetKind) => Math.max(1000, observedTo - Math.max(at, data.from, data.startedAt, reset(kind)));
    const damagePoint: GraphPoint = { at: Math.max(at, reset('damage')), exposureMs: elapsed('damage') };
    const goldPoint: GraphPoint = { at: Math.max(at, reset('gold')) }, lootPoint: GraphPoint = { at: Math.max(at, reset('loot')) }, pingPoint: GraphPoint = { at: Math.max(at, reset('ping')) };
    for (const line of series) {
      const lineNames = filters.compare ? [line.label] : names;
      const rows = selected.filter(row => lineNames.includes(row.character));
      const covered = (kind: MetricResetKind) => rows.some(row => row.observedMs > 0 && row.last.at >= reset(kind));
      const acquired = sum(rows.flatMap(row => row.loot).filter(item => !filters.item || item.item === filters.item).map(item => item.quantity));
      cumulativeLoot.set(line.key, (cumulativeLoot.get(line.key) || 0) + acquired);
      lootPoint[line.key] = covered('loot') ? filters.loot === 'total' ? cumulativeLoot.get(line.key) ?? 0 : acquired : null;
      damagePoint[line.key] = covered('damage') ? sum(rows.flatMap(row => row.damage).filter(hit =>
        (!filters.monster || hit.monster === filters.monster) && (!filters.skill || hit.skill === filters.skill)).map(hit => hit.amount)) * 1000 / elapsed('damage') : null;
      let balance = 0, completeBalance = true;
      for (const name of lineNames) {
        const latest = rows.filter(row => row.character === name && row.last.at >= reset('gold')).sort((a, b) => b.last.at - a.last.at)[0];
        if (!latest) { completeBalance = false; continue; }
        balance += latest.last.gold;
        if (!baselines.has(name)) baselines.set(name, latest.goldStart && latest.goldStart.at >= reset('gold') ? latest.goldStart.gold : latest.first.at >= reset('gold') ? latest.first.gold : latest.last.gold);
      }
      goldPoint[line.key] = covered('gold') && completeBalance ? filters.gold === 'balance' ? balance : balance - sum(lineNames.map(name => baselines.get(name) || 0)) : null;
      const pingRows = rows.filter(row => row.last.at >= reset('ping')), pingSamples = sum(pingRows.map(row => row.pingSamples));
      pingPoint[line.key] = pingSamples ? sum(pingRows.map(row => row.pingSum)) / pingSamples : null;
    }
    if (at + data.resolutionMs > reset('damage')) damage.push(damagePoint);
    if (at + data.resolutionMs > reset('gold')) gold.push(goldPoint);
    if (at + data.resolutionMs > reset('loot')) loot.push(lootPoint);
    if (at + data.resolutionMs > reset('ping')) ping.push(pingPoint);
  }
  const average = (input: GraphPoint[]) => input.map((point, index) => {
    const result: GraphPoint = { at: point.at };
    const length = Math.max(1, Math.ceil(filters.smoothingMs / data.resolutionMs));
    for (const line of series) {
      const window = input.slice(Math.max(0, index - length + 1), index + 1);
      let numerator = 0, denominator = 0, complete = true;
      for (const row of window) {
        const value = row[line.key];
        if (value === null) { complete = false; break; }
        const exposure = row.exposureMs ?? data.resolutionMs;
        numerator += value * exposure; denominator += exposure;
      }
      result[line.key] = complete && denominator > 0 ? numerator / denominator : null;
    }
    return result;
  });
  return { series, damage, damageAverage: average(damage), gold, loot, ping };
}
export function withMovingAverage(raw: GraphPoint[], average: GraphPoint[], series: GraphSeries[], windowMs: number) {
  const byTime = new Map(average.map(point => [point.at, point]));
  const data = raw.map(point => ({ ...point, ...Object.fromEntries(series.map(line => ['average:' + line.key, byTime.get(point.at)?.[line.key] ?? null])) }));
  const window = windowMs >= 60_000 ? (windowMs / 60_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'm' : (windowMs / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 's';
  const averages: GraphSeries[] = series.map(line => ({ key: 'average:' + line.key, label: (series.length > 1 ? line.label + ' · ' : '') + 'MA ' + window, color: series.length === 1 ? '#fbbf24' : line.color, dash: '6 4' }));
  return { data, series: [...series, ...averages] };
}
export function currentRate(points: GraphPoint[], series: GraphSeries[], data: MetricsResponse) {
  if (!points.length || data.lastReceivedAt === null || Date.now() - data.lastReceivedAt > 5000 || Date.now() - data.to > 5000) return null;
  const current = points[points.length - 1];
  const values = series.map(line => current[line.key]).filter((value): value is number => value !== null);
  return values.length ? sum(values) : null;
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
