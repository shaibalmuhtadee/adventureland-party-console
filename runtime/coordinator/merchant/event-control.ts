import { selectedEvents } from '../../../dashboard/lib/event-policy.ts';

/** Optional fields preserve compatibility with saved state and older heartbeats. */
export interface MerchantEventState {
  dailyDungeons?: import("../../dungeons/contracts.ts").DungeonState;
  merchantCharacter: string | null;
  merchantEventCombatEnabled?: boolean;
  eventSelectionsByCharacter?: Record<string, string[]>;
  eventsByCharacter?: Record<string, boolean>;
  statuses: Record<string, { seenAt?: number; merchantEventReserved?: boolean } | undefined>;
  eventSessions?: Record<string, { event?: string; participants?: string[] }>;
  eventReturn?: { participants: string[] } | null;
  deferredEventReturns?: Record<string, unknown>;
}

export function merchantEventRecoveryReserved(state: Pick<MerchantEventState, 'merchantCharacter' | 'eventReturn' | 'eventSessions' | 'deferredEventReturns'>): boolean {
  const name = state.merchantCharacter;
  if (!name) return false;
  if (state.eventReturn?.participants.includes(name) || state.deferredEventReturns?.[name]) return true;
  return !!state.eventSessions?.[name]?.participants?.includes(name);
}

export function merchantEventReserved(state: MerchantEventState, now: number): boolean {
  if (merchantEventRecoveryReserved(state)) return true;
  const name = state.merchantCharacter;
  if (!name || state.merchantEventCombatEnabled !== true) return false;
  const status = state.statuses[name];
  return !!status && Number(status.seenAt) >= now - 10000 && !!status.merchantEventReserved &&
    selectedEvents(state, name).some(event => event !== 'anniversary');
}
