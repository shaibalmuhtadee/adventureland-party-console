import type { Entity, ItemInfo, MonsterEntity, ServerToClient_hit, ServerToClient_chest_opened, ServerToClient_chest_opened_loot } from 'typed-adventureland';
import { METRIC_BUCKET_MS, type MetricBatch, type MetricFrame, type MetricSample } from '../metrics/contracts.ts';
import { metricNumber, parseMetricFrame } from '../metrics/parse.ts';
import { encouragementLuck } from '../metrics/luck.ts';

interface Ports {
  now(): number;
  current(): boolean;
  connected(): boolean;
  name(): string;
  own(actor: string): boolean;
  ownedCharacter(name: string): boolean;
  context(): { server: string; map: string; instance: string; party: string[] };
  sample(): Omit<MetricSample, 'at'>;
  send(batch: MetricBatch): Promise<unknown>;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}
type Frame = MetricFrame & { server: string };
interface Journal { runtime: string; sequence: number; queue: Frame[]; lost: boolean; goldMovement: number }
// Upstream hit declarations omit `dead` and `actor`, seen in native AoE packets.
type Hit = Omit<ServerToClient_hit, 'source'> & { source?: string; dead?: boolean; actor?: string; skill?: string; mtype?: string };
// Native cache_item preserves properties omitted by upstream chest item types.
type LootReward = Omit<ServerToClient_chest_opened_loot, 'items'> & {
  items: Array<ServerToClient_chest_opened_loot['items'][number] & Partial<Pick<ItemInfo, 'p' | 'stat_type'>>>;
};
type LootOutcome = LootReward | Extract<ServerToClient_chest_opened, { gone: true }>;
type Target = Pick<Entity, 'id' | 'mtype' | 'type'>;
type MonsterTarget = Pick<MonsterEntity, 'id' | 'mtype' | 'type'>;
function isMonsterTarget(target: Target | null | undefined): target is MonsterTarget {
  return !!target && target.type === 'monster' && typeof target.mtype === 'string' && target.mtype.length > 0;
}

/** One collector per CODE generation. Retries keep their original bucket and sequence. */
export function installPartyMetrics(ports: Ports) {
  const key = 'party-metrics-v1:' + ports.name();
  const journal: Journal = { runtime: Date.now() + '-' + Math.random().toString(36).slice(2), sequence: 0, queue: [], lost: false, goldMovement: 0 };
  // Restored data crosses a storage boundary. Accept only our bounded versioned envelope;
  // the coordinator performs full frame validation before accepting measurements.
  try {
    const saved: unknown = JSON.parse(ports.storage.getItem(key) || 'null');
    if (saved && typeof saved === 'object' && 'runtime' in saved && typeof saved.runtime === 'string' &&
        'sequence' in saved && typeof saved.sequence === 'number' && 'queue' in saved && Array.isArray(saved.queue)) {
      journal.runtime = saved.runtime;
      journal.sequence = saved.sequence;
      if ('goldMovement' in saved && metricNumber(saved.goldMovement, -Number.MAX_SAFE_INTEGER)) journal.goldMovement = saved.goldMovement;
      for (const value of saved.queue.slice(-720)) {
        const parsed = parseMetricFrame(value);
        if (parsed && value && typeof value === 'object' && 'server' in value && typeof value.server === 'string')
          journal.queue.push({ ...parsed, server: value.server });
        else journal.lost = true;
      }
      journal.lost ||= 'lost' in saved && saved.lost === true;
    }
  } catch { journal.lost = true; }
  let active: Frame | undefined, busy = false, previousAt = ports.now(), previousServer = ports.context().server;
  const seen = new Map<string, number>();
  const targets = new Map<string, { target: MonsterTarget; at: number; context: string }>();
  const observedDeaths = new Map<string, number>();
  let prunedAt = 0;
  function prune(at: number) {
    if (at - prunedAt < 1000) return;
    prunedAt = at;
    for (const [key, time] of seen) if (at - time > 30_000) seen.delete(key);
    for (const [id, value] of targets) if (at - value.at > 30_000) targets.delete(id);
  }
  function remember(id: string, at: number) {
    prune(at);
    if (seen.has(id)) return false;
    seen.set(id, at);
    return true;
  }
  function sample(at: number): MetricSample { return { ...ports.sample(), at, goldMovement: journal.goldMovement }; }
  function persist() {
    try { ports.storage.setItem(key, JSON.stringify(journal)); }
    catch { journal.lost = true; }
  }
  function seal() {
    const sealed = active;
    if (!sealed) return;
    // Resolve credit coverage when sealing, after native hit/credit callbacks
    // have had a chance to arrive in either order.
    if (sealed.credits.some(credit => (observedDeaths.get(credit.monster) || 0) < sealed.first.at - 3000)) sealed.partial = true;
    journal.queue.push(sealed);
    active = undefined;
    if (journal.queue.length > 720) {
      journal.queue.splice(0, journal.queue.length - 720);
      journal.lost = true;
    }
    persist();
  }
  function goldMovement(data: unknown) {
    // Native bank gold replies are absent from the upstream response union.
    // Parse the raw socket boundary without widening the game's declared types.
    if (!ports.current() || !data || typeof data !== 'object' ||
        !('response' in data) || !('gold' in data) || !metricNumber(data.gold) ||
        'failed' in data && data.failed) return;
    const response = data.response;
    const transfer = response === 'gold_sent' || response === 'gold_received';
    const bank = response === 'bank_store' || response === 'bank_withdraw';
    if (!transfer && !bank) return;
    // The native response names the other character. External gifts/payments
    // remain real income/expenses; moving gold within this account does not.
    if (transfer && (!('name' in data) || typeof data.name !== 'string' || !ports.ownedCharacter(data.name))) return;
    journal.goldMovement += (response === 'gold_sent' || response === 'bank_store' ? 1 : -1) * data.gold;
    persist();
  }
  function frame(at: number) {
    const server = ports.context().server, bucket = Math.floor(at / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
    if (active && (active.at !== bucket || active.server !== server)) seal();
    if (!active) {
      const value = sample(at);
      active = { at: bucket, server, sequence: ++journal.sequence, observedMs: 0, partial: journal.lost,
        damage: [], credits: [], kills: [], loot: [], first: value, last: value };
      journal.lost = false;
    }
    return active;
  }
  function hit(data: Hit, target?: Target | null) {
    if (!ports.current()) return;
    const at = ports.now(), context = ports.context(), scope = JSON.stringify([context.server, context.map, context.instance]);
    prune(at);
    if (isMonsterTarget(target)) targets.set(String(target.id), { target: { id: target.id, type: target.type, mtype: target.mtype }, at, context: scope });
    const remembered = targets.get(String(data.id));
    const monster = isMonsterTarget(target) ? target : remembered?.context === scope ? remembered.target : null;
    if (!monster) return;
    const rawActor = String(data.hid || data.actor || ''), own = ports.own(rawActor), actor = own ? ports.name() : rawActor;
    if (data.pid && !remember(JSON.stringify(['hit', scope, data.pid, data.id, actor]), at)) return;
    if (own && Number(data.damage) > 0 && !data.miss && !data.evade && !data.avoid) {
      const current = frame(at), skill = data.source || data.skill || 'attack';
      const damage = current.damage.find(entry => entry.monster === monster.mtype && entry.skill === skill);
      if (damage) { damage.amount += Number(data.damage); damage.hits++; }
      else if (current.damage.length < 128) current.damage.push({ monster: monster.mtype, skill, amount: Number(data.damage), hits: 1 });
      else current.partial = true;
    }
    if (!(data.kill || data.dead) || (!own && !context.party.includes(actor))) return;
    observedDeaths.set(monster.mtype, at);
    const id = JSON.stringify([context.server, context.map, context.instance, String(monster.id), data.pid || 'death']);
    if (!remember(id, at)) return;
    const current = frame(at);
    if (current.kills.length < 256) current.kills.push({ id, at, monster: monster.mtype, actor });
    else current.partial = true;
  }
  // Native kill_credit has no encounter ID in the installed client contract.
  // Retain character credits separately rather than guessing a party death ID.
  function credit(data: Pick<MonsterEntity, 'mtype'>) {
    if (!ports.current()) return;
    const at = ports.now(), current = frame(at), entry = current.credits.find(value => value.monster === data.mtype);
    if (entry) entry.count++;
    else if (current.credits.length < 128) current.credits.push({ monster: data.mtype, count: 1 });
    else current.partial = true;
  }
  function loot(data: LootOutcome) {
    if (!ports.current() || 'gone' in data) return;
    const at = ports.now(), context = ports.context(), current = frame(at);
    // Native chest outcomes name the recipient. Inventory diffs cannot distinguish
    // transfers, simultaneous chests, banking, purchases, or production.
    data.items.forEach((item, index) => {
      if (item.looter !== ports.name()) return;
      const id = JSON.stringify([context.server, context.map, context.instance, data.id, index, item.looter]);
      if (!remember(id, at)) return;
      const variant = JSON.stringify({ level: item.level || 0, ...itemProperties(item) });
      if (current.loot.length < 256) current.loot.push({ id, at, item: item.name, variant, quantity: item.q || 1 });
      else current.partial = true;
    });
  }
  async function flush() {
    if (busy || !journal.queue.length || !ports.current() || !ports.connected()) return;
    busy = true;
    const server = journal.queue[0].server;
    const frames: Frame[] = [];
    for (const next of journal.queue) { if (next.server !== server || frames.length >= 6) break; frames.push(next); }
    try {
      const result = await ports.send({ character: ports.name(), server, runtime: journal.runtime, frames });
      if (!ports.current()) return;
      if (result && typeof result === 'object' && 'expired' in result && typeof result.expired === 'number' && result.expired > 0) journal.lost = true;
      journal.queue.splice(0, frames.length);
      persist();
    } catch { /* Original frames remain journaled for the next pulse. */ }
    finally { busy = false; }
  }
  function pulse() {
    if (!ports.current()) { clearInterval(timer); return; }
    const at = ports.now(), server = ports.context().server;
    if (!ports.connected()) { seal(); previousAt = at; previousServer = ''; return; }
    // Attribute observed elapsed time to its original server and bucket. Long
    // suspension/disconnect intervals remain gaps rather than invented inactivity.
    if (at >= previousAt && at - previousAt <= 2500 && server === previousServer) {
      const end = Math.floor(previousAt / METRIC_BUCKET_MS) * METRIC_BUCKET_MS + METRIC_BUCKET_MS;
      const old = frame(previousAt);
      old.observedMs += Math.min(at, end) - previousAt;
      old.last = sample(Math.min(at, end));
      if (at > end) {
        const next = frame(at);
        next.observedMs += at - end;
        next.last = sample(at);
      }
    } else {
      seal();
      frame(at).partial = true;
    }
    previousAt = at; previousServer = server;
    // Seal each pulse so live kills and damage can be delivered every second.
    // Frame identities remain immutable across retries.
    if (active) seal();
    void flush();
  }
  const timer = setInterval(pulse, 1000);
  return { hit, loot, credit, goldMovement };
}
function itemProperties(item: Partial<Pick<ItemInfo, 'p' | 'stat_type'>>) {
  return { ...(item.p ? { p: item.p } : {}), ...(item.stat_type ? { stat_type: item.stat_type } : {}) };
}
Object.assign(globalThis, { installPartyMetrics, partyMetricsEncouragementLuck: encouragementLuck });
