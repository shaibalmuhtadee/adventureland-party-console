'use client';
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MetricsBarsResponse } from '../../../runtime/metrics/contracts.ts';
import type { TemporaryMetricReset } from './metrics-series';
import { read, useVisible } from './query-cache';
import { MetricsChart } from './metrics-chart';
import { MetricsSelect } from './metrics-controls';
import { MetricsFilter } from './metrics-filter';

interface Props {
  metric: 'damage' | 'loot'; active: boolean; live: boolean; from: number; to: number; clock: number;
  characters: string[]; server: string; names: Map<string, string>; monsterNames: Map<string, string>; skillNames: Map<string, string>;
  resetAt: number; temporaryReset?: TemporaryMetricReset;
  onReset(): void; resetting: boolean; resetDisabled: boolean; resetTitle: string;
}
const units = [{ value: 900_000, label: '/ 15 min', suffix: '/15m' }, { value: 1_800_000, label: '/ 30 min', suffix: '/30m' }, { value: 3_600_000, label: '/ hour', suffix: '/h' }, { value: 86_400_000, label: '/ day', suffix: '/day' }];
/** Same categorical presentation as kills. DPS compares characters/skills;
 * acquired-item bars count units, rather than inventory slots or transfers.
 */
export function MetricsMeasurements(props: Props) {
  const client = useQueryClient(), visible = useVisible();
  const [by, setBy] = useState<'character' | 'skill'>('character'), [monsters, setMonsters] = useState<string[]>([]), [skills, setSkills] = useState<string[]>([]), [items, setItems] = useState<string[]>([]), [rateMs, setRateMs] = useState(3_600_000);
  const day = new Date(props.clock); day.setHours(0, 0, 0, 0);
  const next = new Date(day); next.setDate(next.getDate() + 1);
  const dayFrom = day.getTime(), dayTo = next.getTime();
  const from = Math.max(props.from, props.temporaryReset?.at || 0);
  const valid = Number.isFinite(from) && Number.isFinite(props.to) && from < props.to && props.to - from <= 180 * 86_400_000;
  const query = useQuery({
    queryKey: ['party', 'metrics', 'bars', props.metric, by, from, props.to, dayFrom, props.characters, props.server, monsters, skills, items],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ metric: props.metric, by, from: String(from), to: String(props.to), dayFrom: String(dayFrom), dayTo: String(dayTo) });
      for (const [key, values] of [['characters', props.characters], ['monsters', monsters], ['skills', skills], ['items', items]] as const) if (values.length) params.set(key, values.join(','));
      if (props.server) params.set('servers', props.server);
      return read<MetricsBarsResponse>(client, '/metrics/bars?' + params, signal);
    },
    enabled: props.active && visible && valid && !props.resetDisabled, staleTime: props.live ? 500 : Infinity, gcTime: 10_000,
    placeholderData: keepPreviousData, retry: false,
  });
  const data = query.data;
  const elapsedMs = props.temporaryReset && data ? Math.max(0, data.to - Math.max(data.from, props.temporaryReset.at)) : data?.elapsedMs || 0;
  const aligned = !!data && data.metric === props.metric && (data.metric !== 'damage' || data.by === by);
  const fresh = aligned && data.resetAt >= props.resetAt;
  const rows = fresh ? data.rows.map(row => {
    // A display-only item reset subtracts its last visible partial bucket.
    const baseline = props.temporaryReset?.values.filter(value => (!props.characters.length || props.characters.includes(value.character)) && (!props.server || value.server === props.server)) || [];
    const previous = baseline.flatMap(value => value.loot).filter(item => item.item === row.id).reduce((sum, item) => sum + item.quantity, 0);
    return props.metric === 'loot' && props.temporaryReset && data.from < props.temporaryReset.at ? { ...row, amount: Math.max(0, row.amount - previous) } : row;
  }) : [];
  const unit = units.find(unit => unit.value === rateMs) || units[2];
  const label = (id: string) => props.metric === 'loot' ? props.names.get(id) || id : by === 'skill' ? props.skillNames.get(id) || id : id;
  const categories = rows.map(row => ({ label: label(row.id), total: row.total, detailLabel: props.metric === 'damage' ? 'Damage' : 'Total',
    rate: elapsedMs > 0 ? new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3, notation: row.amount >= 10000 ? 'compact' : 'standard' }).format(row.amount * (props.metric === 'damage' ? 1000 : rateMs) / elapsedMs) + (props.metric === 'damage' ? '/s' : unit.suffix) : '—' }));
  const daily = rows.reduce((sum, row) => sum + row.today, 0);
  const amount = (row: { amount: number }) => props.metric === 'damage' ? elapsedMs > 0 ? row.amount * 1000 / elapsedMs : 0 : row.amount;
  return <MetricsChart title={props.metric === 'damage' ? 'DPS' : 'Items acquired'} data={rows.map((row, at) => ({ at, amount: amount(row) }))}
    series={[{ key: 'amount', label: props.metric === 'damage' ? 'Average DPS in selected range' : 'Acquired in selected range', color: props.metric === 'damage' ? '#a78bfa' : '#fbbf24' }]}
    yLabel={props.metric === 'damage' ? 'Damage / sec' : 'Quantity'} xFormat={value => label(rows[Math.round(value)]?.id || '')}
    type="bar" barCategories={categories} countAxis={props.metric === 'loot'} logarithmic
    currentValue={{ amount: data && !query.isError ? daily : null, unit: props.metric === 'damage' ? 'damage today' : 'items today', label: props.metric === 'damage' ? 'Total damage today' : 'Total items acquired today' }}
    onReset={props.onReset} resetting={props.resetting} resetDisabled={props.resetDisabled} resetTitle={props.resetTitle}
    empty={!valid ? 'No data since reset' : query.isError ? 'Metrics unavailable' : query.isPending ? 'Loading…' : 'No recorded data'}
    controls={props.metric === 'damage' ? <>
      <MetricsSelect label="DPS categories" value={by} onChange={value => setBy(value === 'skill' ? 'skill' : 'character')} options={[{ value: 'character', label: 'By character' }, { value: 'skill', label: 'By skill' }]} className="w-40" />
      <MetricsFilter label="Monster" allLabel="All monsters" selected={monsters} options={(data?.monsters || []).map(id => ({ id, label: props.monsterNames.get(id) || id }))} onChange={setMonsters} />
      <MetricsFilter label="Skill" allLabel="All skills" selected={skills} options={(data?.skills || []).map(id => ({ id, label: props.skillNames.get(id) || id }))} onChange={setSkills} />
    </> : <>
      <MetricsFilter label="Item" allLabel="All items" selected={items} options={(data?.items || []).map(id => ({ id, label: props.names.get(id) || id }))} onChange={setItems} />
      <MetricsSelect label="Acquisition rate" value={String(rateMs)} onChange={value => setRateMs(Number(value))} options={units.map(unit => ({ value: String(unit.value), label: unit.label }))} className="w-32" />
    </>} />;
}
