'use client';
import { useMemo, useState } from 'react';
import type { MetricsResponse } from '../../../runtime/metrics/contracts.ts';
import { MetricsChart } from './metrics-chart';
import { MetricsSelect } from './metrics-controls';
import type { GraphPoint } from './metrics-series';

/** Each character starts at its first observed balance. Joining the chart does
 * not count existing wealth as income. Missing/offline characters retain their
 * last known gain instead of invalidating every party point.
 */
export function goldGainSeries(data: MetricsResponse, characters: string[], server: string) {
  const start = Math.max(data.from, data.startedAt, data.resets?.gold || 0);
  const balances = new Map<string, { baseline: number; balance: number; at: number }>();
  const points: GraphPoint[] = [];
  for (const point of data.points) {
    if (point.at + data.resolutionMs <= start) continue;
    const rows = point.values.filter(row => (!characters.length || characters.includes(row.character)) && (!server || row.server === server) && row.last.at >= start)
      .sort((a, b) => a.first.at - b.first.at);
    for (const row of rows) {
      const previous = balances.get(row.character);
      const first = row.goldStart && row.goldStart.at >= start ? row.goldStart.gold : row.first.at >= start ? row.first.gold : row.last.gold;
      if (!previous) balances.set(row.character, { baseline: first, balance: row.last.gold, at: row.last.at });
      else if (row.last.at >= previous.at) { previous.balance = row.last.gold; previous.at = row.last.at; }
    }
    points.push({ at: Math.max(point.at, start), gain: balances.size ? [...balances.values()].reduce((total, value) => total + value.balance - value.baseline, 0) : null });
  }
  return points;
}
export function MetricsGold({ data, characters, server, onReset, resetting, resetDisabled, resetTitle }: {
  data: MetricsResponse; characters: string[]; server: string; onReset(): void; resetting: boolean; resetDisabled: boolean; resetTitle: string;
}) {
  const [character, setCharacter] = useState('');
  const available = data.characters.filter(name => !characters.length || characters.includes(name));
  const selected = available.includes(character) ? character : '';
  const points = useMemo(() => goldGainSeries(data, selected ? [selected] : characters, server), [data, selected, characters, server]);
  const latest = points[points.length - 1]?.gain ?? null;
  return <MetricsChart title="Gold history" data={points} series={[{ key: 'gain', label: selected || 'Combined net gold gain', color: '#4ade80' }]}
    yLabel="Gold gained (net)" currentValue={{ amount: latest, unit: 'gold gained', label: 'Net gold gained in selected range' }}
    onReset={onReset} resetting={resetting} resetDisabled={resetDisabled} resetTitle={resetTitle}
    controls={<MetricsSelect label="Gold character" value={selected} onChange={setCharacter} options={[{ value: '', label: 'All characters' }, ...available.map(name => ({ value: name, label: name }))]} className="w-48 max-w-none" />} />;
}
