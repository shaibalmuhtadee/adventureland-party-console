# Solo Farming + Events

The party-level card configures one farmer, up to two distinct companions, a
merchant, one operating realm, selected Halloween bosses, and preparation time.
Defaults are the account's rogue, warrior and priest, the configured merchant,
US IV, both bosses, and 120 seconds. Save the farmer's personal farming location
using the existing farming controls before Start. Choosing another class uses
that character's own farming profile and existing class logic.

The coordinator owns the schedule while the dashboard is closed. It persists
membership separately from headless slots, plus the run ID, phase, encounter,
generation, completed encounters, collection progress and pending operation.
The plan never changes actual game homes or the Console's Home world preferences.
Fresh managed reports must show eligible fighters at their actual game home
without realm fatigue. Steam and external sessions cause a visible conflict.

The sequence is solo → preparation → participation → loot → town → collection
→ return. Announced spawn times determine preparation. One encounter owns the
whole trip, including overlapping bosses. Fighters use existing shared Halloween
travel and combat. A merchant with event combat disabled still travels, without
enabling combat. Boss attacks wait for the selected fighters to assemble.

After the encounter ends, fresh reports must show no eligible chests or departure
combat before town travel. Collection uses the existing native handoff and shared
call budget, without the inventory-pressure threshold. It preserves locked and
bound stock, computers, trackers, potions, selected consumables, equipment swap
stock and existing manual/crafting/delivery reservations. It adds no selling,
destroying, upgrading or compounding operations.

Only a receipt matching the run, encounter generation, command, character and
current worker instance can settle an operation. Transfer receipts then wait for
fresh fighter and merchant inventories and matching received cargo. Every fighter,
including the farmer, must have no remaining transferable stock before companion
logout. A full merchant pauses progress with a capacity message. Free capacity
manually in game and resume if you paused the plan. No companion leaves early.

Pause prevents new coordinator phases and commands, while an issued operation
can finish. Resume reconciles current sessions and inventories. Manual roster or
realm controls pause orchestration before acting, including manual merchant
logout. Stop completes necessary loot and collection, confirms companion logout,
returns the farmer, then releases ownership. Stop during participation waits for
that encounter's completion. Saved party, Follow, event and farming preferences
become effective again when ownership is released.

Worker startup defers to an active running plan's desired roster and realm.
A paused plan restores only its currently saved slots, preserving manual logout.
Bank helpers cannot start under plan ownership. Conflicting merchant jobs keep
their queued work and wait during the trip and mandatory collection.

## Manual verification

1. Start with the default team. Confirm only farmer and merchant remain online,
   the rogue resumes its saved crab farm, and saved Follow/event settings survive.
2. Close the dashboard. At the selected announced spawn minus 120 seconds,
   confirm both companions log into US IV, all fighters assemble and participate,
   and the merchant follows its existing combat setting.
3. Kill the committed boss. Confirm eligible chests finish before departure,
   everyone reaches main town, and every fighter transfers eligible loot even
   with mostly empty bags. Check protected stock remains carried.
4. Confirm inventory observations precede companion logout and farmer return.
   Repeat with a full merchant and with overlapping or cancelled spawns.
5. Pause and resume during transfer, manually log the merchant out, and restart
   the coordinator during collection. Confirm no automatic relogin while paused,
   no early companion logout, and no stale receipt completing a newer operation.
6. Try mage instead of priest and warrior as farmer with their own saved profiles.
   Stop after cleanup, then check ordinary behavior with the plan disabled.

Activate character, coordinator and dashboard edits with the supported full
`scripts/start-console.ps1` restart. Typecheck is required; gameplay verification
for this change is manual.
