const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(at: number) {
  return Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]));
}
export function metricDay(at: number) {
  const value = parts(at);
  return value.year + '-' + value.month + '-' + value.day;
}
export function shiftMetricDay(day: string, days: number) {
  const at = Date.parse(day + 'T00:00:00Z');
  return Number.isFinite(at) ? new Date(at + days * 86_400_000).toISOString().slice(0, 10) : '';
}
/** Resolve Toronto midnight with its actual offset, including 23/25-hour DST days. */
export function metricDayStart(day: string) {
  const midnight = Date.parse(day + 'T00:00:00Z');
  if (!Number.isFinite(midnight)) return NaN;
  let at = midnight;
  for (let i = 0; i < 3; i++) {
    const value = parts(at);
    const wall = Date.parse(value.year + '-' + value.month + '-' + value.day + 'T' + value.hour + ':' + value.minute + ':' + value.second + 'Z');
    at += midnight - wall;
  }
  return at;
}
