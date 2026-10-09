import { requestObject } from '../http/contracts.ts';

/** Matches the header's active-slot scope, excluding bank storage characters. */
export function accountGoldSnapshot(bank: unknown, slots: unknown, bankbois: unknown, statuses: Record<string, unknown>) {
  const excluded = new Set(Array.isArray(bankbois) ? bankbois.map(entry => requestObject(entry).name) : []);
  const names = new Set(Array.isArray(slots) ? slots.flatMap(input => {
    const slot = requestObject(input);
    return typeof slot.character === 'string' && !['empty', 'offline', 'failed'].includes(String(slot.state)) && !excluded.has(slot.character) ? [slot.character] : [];
  }) : []);
  const balances = [...names].map(name => requestObject(statuses[name]).gold);
  const carried = balances.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ? balances.reduce((sum, value) => sum + value, 0) : null;
  const bankGold = requestObject(bank).gold;
  return { carried, total: typeof bankGold === 'number' && Number.isFinite(bankGold) && carried !== null ? bankGold + carried : null };
}
