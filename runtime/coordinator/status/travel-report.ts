import { requestObject } from '../http/contracts.ts';

// These fields describe one game sample, not independently mergeable domains.
export const travelReportFields = ['monsterHunt', 'map', 'in', 'server', 'x', 'y', 'hp', 'max_hp', 'rip',
  'lastDeath', 'deathLoop', 'moving', 'transporting', 'speed', 'convoyNavigation', 'convoyProtocol',
  'movementGeometry', 'movement', 'combatSelection', 'groupedCombat', 'travelSample'] as const;

export function sequencedTravelReport(body: unknown): boolean {
  const b = requestObject(body), s = requestObject(b.travelSample);
  return typeof s.runtimeId === 'string' && s.runtimeId === requestObject(b.combatSelection).runtimeId &&
    Number.isSafeInteger(s.sequence) && Number(s.sequence) > 0 && typeof s.connected === 'boolean';
}

/** Receipt time establishes freshness; runtime-scoped sequence establishes order.
 * Client clock corrections must neither retire a fresh sample nor revive a replay. */
export function acceptTravelReport<T extends {name: string}>(body: T, previous: T | undefined, now: number): T {
  const b = requestObject(body), old = requestObject(previous);
  const incoming = requestObject(b.travelSample), before = requestObject(old.travelSample);
  if (incoming.runtimeId === before.runtimeId && Number(incoming.sequence) <= Number(before.sequence)) {
    const retained = Object.fromEntries(travelReportFields.map(key => [key, old[key]]));
    return {...body, ...retained, seenAt: old.seenAt};
  }
  const group = requestObject(b.groupedCombat);
  return {...body, seenAt: now,
    travelSample: {...incoming, receivedAt: now, rawObservationAt: group.currentAttackersAt},
    groupedCombat: {...group, currentAttackersAt: incoming.connected && Array.isArray(group.currentAttackers) ? now : 0}};
}
