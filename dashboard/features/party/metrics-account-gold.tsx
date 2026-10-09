'use client';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { METRIC_BUCKET_MS, type AccountGoldResponse } from '../../../runtime/metrics/contracts.ts';
import { MetricsChart } from './metrics-chart';
import { read, useVisible } from './query-cache';

export function MetricsAccountGold(props: { active: boolean; clock: number; live: boolean; resetAt: number; total: number | null; onReset(): void; resetDisabled: boolean }) {
  const client = useQueryClient(), visible = useVisible();
  const historyClock = Math.floor(props.clock / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
  const query = useQuery({
    queryKey: ['party', 'metrics', 'account-gold', props.resetAt, historyClock],
    queryFn: ({ signal }) => read<AccountGoldResponse>(client, '/metrics/account-gold?resetAt=' + props.resetAt + '&to=' + historyClock, signal),
    enabled: props.active && visible && !props.resetDisabled, staleTime: props.live ? METRIC_BUCKET_MS : Infinity, gcTime: 10_000, placeholderData: keepPreviousData, retry: false,
  });
  return <MetricsChart title="Total account gold" data={(query.data?.points || []).filter(point => point.at >= props.resetAt).map(point => ({ at: point.at, total: point.total }))}
    series={[{ key: 'total', label: 'Total account gold', color: '#fbbf24' }]} yLabel="Gold"
    currentValue={{ amount: props.total, unit: 'total gold', exact: true }} onReset={props.onReset} resetDisabled={props.resetDisabled}
    resetTitle="Clear graph; keep stored history" empty={query.isError ? 'Metrics unavailable' : query.isPending ? 'Loading…' : 'No recorded account balance'}
    optionDetails={<p className="text-sm text-[#aabfb6]">The header's bank plus carried total, recorded every 10 seconds even with the dashboard closed. History starts when this tracking was enabled and is retained for 180 days.</p>} />;
}
