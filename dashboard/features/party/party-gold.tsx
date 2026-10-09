'use client';
import { useQueries } from '@tanstack/react-query';
import { Coins } from 'lucide-react';
import { characterKey } from './dashboard-live';
import { abbreviatedGold } from './abbreviated-gold';
import type { PartyState } from './party-state';
import type { Char } from './char';

export function partyGoldNames(
  state: Pick<PartyState, 'activeSlots' | 'bankbois'>,
) {
  const excluded = new Set((state.bankbois || []).map((entry) => entry.name));
  return [
    ...new Set(
      (state.activeSlots || [])
        .filter(
          (slot) =>
            slot.character &&
            !['empty', 'offline', 'failed'].includes(slot.state),
        )
        .map((slot) => slot.character!),
    ),
  ].filter((name) => !excluded.has(name));
}
const selectGold = (value: Partial<Char> | null) => value?.gold ?? null;
export function goldTotals(
  bank: number | null | undefined,
  balances: (number | null | undefined)[],
) {
  const carried = balances.every(
    (value) => value != null && Number.isFinite(value),
  )
    ? balances.reduce<number>((sum, value) => sum + value!, 0)
    : null;
  return {
    carried,
    total: bank != null && carried != null ? bank + carried : null,
  };
}
export function PartyGold({ state }: { state: PartyState }) {
  const balances = useQueries({
    queries: partyGoldNames(state).map((name) => ({
      queryKey: characterKey(name, 'vitals'),
      enabled: false,
      staleTime: Infinity,
      queryFn: (): Partial<Char> => ({}),
      select: selectGold,
    })),
  });
  const { carried, total } = state.accountGold ?? goldTotals(
    state.bankGold,
    balances.map((query) => query.data),
  );
  const exact = (value: number | null | undefined) =>
    value == null ? 'unknown' : value.toLocaleString();
  return (
    <div
      className="whitespace-nowrap font-mono text-sm text-amber-300"
      title={`Bank: ${exact(state.bankGold)}; carried: ${exact(carried)}; combined: ${exact(total)} gold. Last reported balances; transfers may have different sampling times.`}
    >
      <div className="flex items-center gap-1.5">
        <Coins className="h-4 w-4" />
        {state.bankGold == null ? '—' : abbreviatedGold(state.bankGold)}
      </div>
      <div className="mt-0.5 text-xs">
        ({total == null ? '—' : abbreviatedGold(total)} total)
      </div>
    </div>
  );
}
