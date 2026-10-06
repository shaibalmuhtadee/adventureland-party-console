# Ponty Shop

Add items through **Catalog > item > Add to Ponty**. The catalog includes all
items, including ingredients such as `ashleaf`, `gslime`, `gemfragment`, and
`cshell`. Equipment comparisons remain limited to equippable items.
The merchant's collapsible
**Ponty shopping list** uses the same removal and clear-all controls as its other
automatic lists. Each entry matches the base item ID, including upgraded and stat
variants. Entries authorize all matching lots, with no quantity or price ceiling.
Purchases use carried gold and, when needed, bank gold. Three inventory slots stay
reserved for merchant logistics. Ponty Shop operates independently of WTB orders.

The merchant's **Ponty Shop** button, after **Clear job queue** and before
**Settings**, queues an immediate trip. The
**Routines** menu enables or disables hourly automatic trips and controls their
priority. Automatic trips default to enabled at priority 30 and require a nonempty
list. Manual clicks bypass the hourly cooldown and the automatic toggle. Repeated
requests share the pending trip. The button remains available during the hourly
cooldown and when a trip is queued or running. Clicking a blocked queued trip
retries it with its saved progress; clicking a running trip reports that it is
already running. An empty shopping list produces an explanation when clicked.

The merchant visits Ponty in Mainland town on US I-V, EU I-IV and ASIA I-II, then
returns to the current selected party server. It uses the coordinator's managed
merchant worker reconnect path. Higher-priority work can pause it between servers.
Disabling automation ends an automatic trip at the next server boundary; purchases
recheck the live toggle and shopping list before execution.

Settings persist `pontyShoppingList` and `pontyShopLastRunAt`. The timestamp records
the first dispatch of a trip, including manual trips, and survives program restarts.
The pending merchant job stores scanned servers and attempted listing IDs. Restart
resumes that trip. Attempts persist before the game purchase call; an ambiguous
purchase is skipped for the rest of that trip. Server transitions allow 90 seconds
for fresh arrival. A timeout retains the trip behind the existing **Retry** control
and starts home recovery. Per-server purchase results and failures appear in the
merchant activity history.

This change requires publishing character, coordinator and dashboard assets
together through `scripts/start-console.ps1`. Building alone does not activate it.
Gameplay and UI behavior require manual validation; no tests were written or run
for this change at the user's request.
