# Inventory swaps

Each character card has a collapsible Inventory swaps section. Choose a strategy,
click inventory gear, choose destination slots when needed, and turn that strategy
on. Selecting a second item for an occupied destination replaces the selection.
Rings, earrings and weapons have explicit destination selectors. Saved selections
remain visible while their items are equipped or missing.

This release includes **Luck before kill** for every character. It considers
living visible monsters targeting that character. Ordinary monsters trigger at
HP <= two party attack cycles. A cycle means one basic attack from each living,
visible, in-range member of the actual game party, including other players.
The estimate includes damage type, armor/resistance piercing, critical chance,
output, fortitude and damage amplification. It does not predict skill bursts.
Cooperative monsters use HP <= 5% of maximum HP instead. The ordinary threshold
is retained for the current swap so its own stat changes cannot cause oscillation.

Selections belong to strategies, so one item can belong to multiple strategies.
The list's first eligible strategy owns the entire swap; priority arrows appear
when more than one strategy exists. Selecting an editor does not disable other
strategies. The current release has one available strategy. Exclusive ownership
avoids combining gear from conflicting strategies or restoring another strategy's
baseline. Future strategies extend the shared catalog and runtime trigger switch.

The character records the actual pre-swap gear before calling `equip_batch`.
It verifies the native slots because a fulfilled batch can still be partial.
It restores before switching strategies, when its trigger ends, when disabled,
and before console commands. A persisted restoration journal survives CODE reload
and character restart. Missing restoration gear reports a blocked status and
retries; it never adopts the luck set as its new baseline. A manual equipment
change outside the console releases ownership of that slot. Console equipment
commands restore first and suppress another swap for that dying target.

Configured gear and temporarily displaced originals are protected from merchant
collection. Remove the selection before deliberately banking or selling that
gear. Swap items follow their identities when inventory positions change.

## Ownership and activation

- `runtime/item-swaps.ts` owns configuration, identities and boundary validation.
- The coordinator saves per-character settings and publishes them to heartbeats
  and the dashboard. Dashboard export/import includes the settings.
- `runtime/characters/roles/item-swaps-runtime.ts` reads native party/monster state
  and evaluates strategies; `item-swap-controller.ts` owns batches and restoration.
- `dashboard/features/party/inventory-swaps.tsx` edits one strategy at a time.

Run `npm run typecheck` and activate with the full `scripts/start-console.ps1`
restart. A coordinator-only restart cannot publish the character runtime.
Gameplay and UI verification are manual for this change, as requested.

## Manual verification

1. On the priest, select luck gear in Inventory swaps and enable Luck before kill.
2. Watch ordinary combat: tank gear stays on until the two-cycle threshold; luck
   gear appears near death, then the exact previous gear returns for the next fight.
3. Check a co-op boss at 5% HP. Add a visible party member outside the console
   roster and confirm ordinary-monster thresholds include that member's damage.
4. Disable the strategy while swapped, change its items, and use a manual equipment
   command. Confirm restoration and the requested new equipment.
5. Move selected gear between inventory slots, select two rings/earrings, fill the
   inventory, and try incompatible weapons. Inspect the status for blocked batches.
6. Reload CODE or restart while swapped. Confirm the original gear restores and
   the configured selections and toggle survive. Confirm merchant collection keeps
   both swap gear and displaced originals.
