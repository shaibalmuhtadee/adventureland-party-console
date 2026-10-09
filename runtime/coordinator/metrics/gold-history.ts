import { METRIC_BUCKET_MS, type GoldHistoryResponse, type GoldSample, type MetricSample, type MetricTotals } from '../../metrics/contracts.ts';

interface Bucket { at: number; width: number; values: MetricTotals[] }
const sample = (value: MetricSample): GoldSample => ({ at: value.at, gold: value.gold,
  ...(value.goldMovement === undefined ? {} : { goldMovement: value.goldMovement }) });
type Row = GoldHistoryResponse['points'][number]['values'][number];
function mergeBalance(values: Map<string, Row>, incoming: MetricTotals) {
  const key = JSON.stringify([incoming.character, incoming.server]), row = values.get(key);
  if (!row) {
    values.set(key, { character: incoming.character, server: incoming.server, first: sample(incoming.first), last: sample(incoming.last),
      ...(incoming.goldStart ? { goldStart: { ...incoming.goldStart } } : {}) });
    return;
  }
  if (incoming.first.at < row.first.at) row.first = sample(incoming.first);
  if (incoming.last.at > row.last.at) row.last = sample(incoming.last);
  if (incoming.goldStart && (!row.goldStart || incoming.goldStart.at < row.goldStart.at)) row.goldStart = { ...incoming.goldStart };
}

/** Read balance endpoints only. Yield during long histories so socket/status work can run. */
export async function goldHistory(buckets: Bucket[], from: number, to: number) {
  const largest = buckets.reduce((width, bucket) => Math.max(width, bucket.width), METRIC_BUCKET_MS);
  const width = Math.max(largest, Math.ceil((to - from) / (600 * largest)) * largest);
  const points = new Map<number, Map<string, Row>>();
  let processed = 0;
  for (const bucket of buckets) {
    const at = Math.floor(bucket.at / width) * width;
    const values = points.get(at) || new Map<string, Row>();
    for (const incoming of bucket.values) mergeBalance(values, incoming);
    points.set(at, values);
    if (++processed % 64 === 0) await new Promise<void>(resolve => setImmediate(resolve));
  }
  return { from: Math.floor(from / width) * width, to, resolutionMs: width,
    points: [...points].sort((a, b) => a[0] - b[0]).map(([at, values]) => ({ at, values: [...values.values()] })) };
}
