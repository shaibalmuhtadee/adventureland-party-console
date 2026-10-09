'use client';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { read, useVisible } from './query-cache';
import { METRIC_BUCKET_MS, type MetricSample, type MetricsResponse, type GoldHistoryResponse } from '../../../runtime/metrics/contracts.ts';
import { MetricsChart } from './metrics-chart';
import { MetricsSelect } from './metrics-controls';
import type { GraphPoint } from './metrics-series';

const profitBalance = (sample: Pick<MetricSample, 'gold' | 'goldMovement'>) => sample.gold + (sample.goldMovement || 0);

/** Each character starts at its first observed balance, adjusted for internal movement. Joining the chart does
 * not count existing wealth as income. Missing/offline characters retain their
 * last known gain instead of invalidating every party point.
 */
export function goldGainSeries(data: GoldHistoryResponse, characters: string[], server: string) {
  const start = Math.max(data.from, data.startedAt, data.resets?.gold || 0);
  const balances = new Map<string, { baseline: number; balance: number; at: number }>();
  const points: GraphPoint[] = [];
  for (const point of data.points) {
    if (point.at + data.resolutionMs <= start) continue;
    const rows = point.values.filter(row => (!characters.length || characters.includes(row.character)) && (!server || row.server === server) && row.last.at >= start)
      .sort((a, b) => a.first.at - b.first.at);
    for (const row of rows) {
      const previous = balances.get(row.character);
      const first = row.goldStart && row.goldStart.at >= start ? row.goldStart : row.first.at >= start ? row.first : row.last;
      if (!previous) balances.set(row.character, { baseline: profitBalance(first), balance: profitBalance(row.last), at: row.last.at });
      else if (row.last.at >= previous.at) { previous.balance = profitBalance(row.last); previous.at = row.last.at; }
    }
    points.push({ at: Math.max(point.at, start), gain: balances.size ? [...balances.values()].reduce((total, value) => total + value.balance - value.baseline, 0) : null });
  }
  return points;
}
export function MetricsGold({ data: sharedData, active, clock, live, resetAt, characters, server, onReset, resetting, resetDisabled, resetTitle }: {
  active: boolean; clock: number; live: boolean; resetAt: number;
  data: MetricsResponse; characters: string[]; server: string; onReset(): void; resetting: boolean; resetDisabled: boolean; resetTitle: string;
}) {
  const client = useQueryClient(), visible = useVisible();
  const historyClock = Math.floor(clock / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
  const query = useQuery({
    queryKey: ['party', 'metrics', 'gold', resetAt, historyClock],
    queryFn: ({ signal }) => read<GoldHistoryResponse>(client, '/metrics?sinceReset=gold&resetAt=' + resetAt + '&to=' + historyClock, signal),
    enabled: active && visible && !resetDisabled && historyClock > resetAt, staleTime: live ? METRIC_BUCKET_MS : Infinity, gcTime: 10_000, placeholderData: keepPreviousData, retry: false,
  });
  const data = useMemo(() => {
    const source = query.data;
    return source ? { ...source, resets: { ...source.resets, gold: Math.max(resetAt, source.resets?.gold || 0) } } : undefined;
  }, [query.data, resetAt]);
  const [character, setCharacter] = useState('');
  const available = (data || sharedData).characters.filter(name => !characters.length || characters.includes(name));
  const selected = available.includes(character) ? character : '';
  const points = useMemo(() => data ? goldGainSeries(data, selected ? [selected] : characters, server) : [], [data, selected, characters, server]);
  const legacy = data?.points.some(point => point.values.some(row => row.last.goldMovement === undefined &&
    (!selected || row.character === selected) && (!characters.length || characters.includes(row.character)) && (!server || row.server === server)));
  const latest = points[points.length - 1]?.gain ?? null;
  return <MetricsChart title="Gold history" data={points} series={[{ key: 'gain', label: selected || 'Combined net gold gain', color: '#4ade80' }]}
    yLabel="Gold gained (net)" currentValue={{ amount: latest, unit: 'gold gained', label: 'Net gold gained since reset' }}
    empty={query.isError ? 'Metrics unavailable' : query.isPending ? 'Loading…' : 'No data since reset'}
    onReset={onReset} resetting={resetting} resetDisabled={resetDisabled} resetTitle={resetTitle}
    optionDetails={<p className="text-sm text-[#aabfb6]">History since the last reset, up to 180 days. Internal transfers and bank movements are excluded.{legacy ? ' Older history predates transfer tracking.' : ''}</p>}
    controls={<MetricsSelect label="Gold character" value={selected} onChange={setCharacter} options={[{ value: '', label: 'All characters' }, ...available.map(name => ({ value: name, label: name }))]} className="w-48 max-w-none" />} />;
}
