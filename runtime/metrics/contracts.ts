/** Metrics wire contracts. These are aggregated observations, not complete game objects. */
export interface MetricContext { character: string; server: string }
export interface MetricDamage { monster: string; skill: string; amount: number; hits: number }
export interface MetricCredit { monster: string; count: number }
export interface MetricKill { id: string; at: number; monster: string; actor: string }
export interface MetricLoot { id: string; at: number; item: string; variant: string; quantity: number }
export interface MetricSample {
  at: number; gold: number; luck: number; ping: number | null; level: number; xp: number; maxXp: number;
  /** Cumulative internal gold sent/deposited minus received/withdrawn. Older history omits it. */
  goldMovement?: number;
  /** Native Encouragement totals, separate from ordinary luckm. Older history omits this field. */
  encouragementLuck?: number;
}
export interface MetricFrame {
  at: number;
  sequence: number;
  observedMs: number;
  partial: boolean;
  damage: MetricDamage[];
  credits: MetricCredit[];
  kills: MetricKill[];
  loot: MetricLoot[];
  first: MetricSample;
  last: MetricSample;
}
export interface MetricBatch extends MetricContext { runtime: string; frames: MetricFrame[] }
export interface MetricTotals extends MetricContext {
  /** Independent gold baseline when other measurements survive a gold reset. */
  goldStart?: Pick<MetricSample, 'at' | 'gold' | 'goldMovement'>;
  observedMs: number;
  partial: boolean;
  damage: MetricDamage[];
  credits: MetricCredit[];
  loot: { item: string; variant: string; quantity: number }[];
  first: MetricSample;
  last: MetricSample;
  samples: number;
  luckSum: number;
  pingSum: number;
  pingSamples: number;
}
export interface MetricDeathTotal { server: string; monster: string; actor: string; count: number }
/** Death attribution is independent of the character that observed the packet. */
export interface MetricPoint { at: number; values: MetricTotals[]; kills: MetricDeathTotal[] }
export interface MetricsResponse {
  version: 1;
  startedAt: number;
  from: number;
  to: number;
  resolutionMs: number;
  points: MetricPoint[];
  characters: string[];
  servers: string[];
  lastReceivedAt: number | null;
  incomplete: boolean;
  resets?: MetricResets;
}
export interface AccountGoldPoint { at: number; total: number | null }
export interface AccountGoldResponse { from: number; to: number; points: AccountGoldPoint[] }
export type GoldSample = Pick<MetricSample, 'at' | 'gold' | 'goldMovement'>;
export interface GoldHistoryResponse {
  startedAt: number; from: number; to: number; resolutionMs: number; characters: string[]; resets?: MetricResets;
  points: { at: number; values: (Pick<MetricTotals, 'character' | 'server' | 'goldStart'> & { first: GoldSample; last: GoldSample })[] }[];
}
export interface MonsterKillSummary {
  monster: string;
  count: number;
  total: number;
  today: number;
}
export interface MetricsKillsResponse {
  version: 1;
  from: number;
  to: number;
  elapsedMs: number;
  dayFrom: number;
  dayTo: number;
  resetAt: number;
  monsters: MonsterKillSummary[];
  lastReceivedAt: number | null;
}
export interface MetricBarSummary { id: string; amount: number; total: number; today: number }
interface MetricsBarsFields {
  version: 1; from: number; to: number; elapsedMs: number;
  dayFrom: number; dayTo: number; resetAt: number; rows: MetricBarSummary[];
  characters: string[]; monsters: string[]; skills: string[]; items: string[];
  lastReceivedAt: number | null;
}
export type MetricsBarsResponse = MetricsBarsFields & ({ metric: 'damage'; by: 'character' | 'skill' } | { metric: 'loot'; by: 'item' });
export const METRIC_RESET_KINDS = ['kills', 'damage', 'gold', 'loot', 'ping'] as const;
export type MetricResetKind = typeof METRIC_RESET_KINDS[number];
export type MetricResets = Partial<Record<MetricResetKind, number>>;
export const METRIC_BUCKET_MS = 10_000;
