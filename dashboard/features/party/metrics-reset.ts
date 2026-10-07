import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MetricResetKind } from '../../../runtime/metrics/contracts.ts';
import { parseMetricResets } from '../../../runtime/metrics/parse.ts';
import { API } from './api';
import { authenticationLost, ReadError } from './query-cache';

/** Only a user click calls this destructive endpoint. Filter changes never erase data. */
export function useMetricsReset() {
  const client = useQueryClient();
  return useMutation({
    scope: { id: 'metrics-reset' },
    mutationFn: async (metric: MetricResetKind | 'all' | 'performance') => {
      const response = await fetch(API + '/metrics/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metric }) });
      if (response.status === 401 || response.status === 403 || response.redirected) {
        authenticationLost(client); throw new ReadError(401, 'Session expired');
      }
      if (!response.ok) throw new Error('Could not reset metrics');
      const result: unknown = await response.json();
      const resets = result && typeof result === 'object' && 'resets' in result ? parseMetricResets(result.resets) : null;
      if (!resets) throw new Error('Invalid metrics reset response');
      return resets;
    },
    onMutate: () => client.cancelQueries({ queryKey: ['party', 'metrics'] }),
    onSuccess: () => { client.removeQueries({ queryKey: ['party', 'metrics'], type: 'inactive' }); },
    onSettled: () => client.invalidateQueries({ queryKey: ['party', 'metrics'] }),
  });
}
