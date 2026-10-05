# Halloween event support plan

Status: implemented and activated through the full console restart, 2026-10-05.
Gameplay verification remains with the user, manually in game.

## Intended behavior

The character card's Events dropdown offers one selectable **Halloween** checkbox. Selecting it enables automatic attendance at Mr. Pumpkin and Mr. Green on the current realm. Following characters inherit the leader's selection. Independent characters and the merchant retain their own selections.

An enabled character continues ordinary activity while neither boss is live. When a boss appears, the runtime obtains event travel permission, travels to its reported position, fights through the existing class runner, collects native rewards, and returns through the existing event recovery flow. Unchecking Halloween cancels voluntary attendance and returns actual participants, even while the boss remains alive.

This first version matches the two-boss attendance implemented by the supplied backup. It does not add server hopping, change the user's roster or equipment, hunt Slenderman, or automate candy exchanges. Native candy drops remain available, and inventory/exchange work continues through existing controls. Slenderman is a separate follow-up because its server report omits coordinates and the backup does not implement attendance for it.

## What the reference implements

Inspected backup revision: `9b577a160a26977613b559fa6982a5925506c28a`.

| Source | Relevant behavior |
| --- | --- |
| [basic_function.7.js, lines 1767–1780](https://github.com/mrdiamond12312/adventure-land-scripts-backup/blob/9b577a160a26977613b559fa6982a5925506c28a/basic_function.7.js#L1767-L1780) | Lists `mrpumpkin` and `mrgreen` as participatable events. |
| [changeToDailyEventTargets, lines 2084–2181](https://github.com/mrdiamond12312/adventure-land-scripts-backup/blob/9b577a160a26977613b559fa6982a5925506c28a/basic_function.7.js#L2084-L2181) | Reads `parent.S.mrpumpkin.live` and `parent.S.mrgreen.live`, chooses the lowest HP fraction among those bosses and Ice Golem, travels with `advanceSmartMove`, then selects the visible boss. Halloween uses its pull strategy. |
| [merchant_frenzinesss.100.js, lines 152–175](https://github.com/mrdiamond12312/adventure-land-scripts-backup/blob/9b577a160a26977613b559fa6982a5925506c28a/merchant_frenzinesss.100.js#L152-L175) | Travels to each Halloween boss only when someone else holds its aggro. Separate helpers gate attacks, HP safety, and boss switching. |
| [server_hop.14.js](https://github.com/mrdiamond12312/adventure-land-scripts-backup/blob/9b577a160a26977613b559fa6982a5925506c28a/server_hop.14.js#L12-L18) | Adds both bosses to cross-server discovery. It uses `hoppable: 0.9999` and `threshold: 0.3` in different admission/stay checks; these are not local combat requirements. |

The backup also changes party membership for these bosses. Do not port those account-specific presets, its external discovery API, or its independent movement loops.

The cached official game data inspected here is `.caracal/game_files/17478/data.js`:

- `G.events.halloween` is seasonal, has no `join`, and uses the item sprite `candy0`. The sprite cannot identify a combat target.
- Mr. Pumpkin's special spawn is on `halloween`; Mr. Green's is on `spookytown`.
- Both bosses spawn adds at HP thresholds. Mr. Pumpkin deals magical damage; Mr. Green deals physical damage and has substantial resistance.

The [pinned upstream server functions](https://github.com/kaansoral/adventureland_mongodb/blob/90052162eb3ebda36c893e1eb4af643913c8f984/node/server_functions.js#L2570-L2648) confirm that the season is reported as `E.halloween = true`, separately from live boss records containing map, coordinates, HP, and aggro target. `spawn_special_monster` uses the game map definitions. Refresh official data before implementation if the installed client version has changed.

## Why the checkbox is disabled today

The current path is:

1. `dashboard/features/party/connected-character-card.tsx` sends `{ character, eventSelections }` through `/formation`.
2. `dashboard/lib/event-policy.ts` supplies the support list and follower inheritance. It omits `halloween`.
3. `runtime/coordinator/http/formation.ts` rejects event IDs outside that list, then saves accepted selections.
4. `runtime/coordinator/status/response.ts` returns selections, event permission state, and the party event hint.
5. `characters/shared.js` detects an event, obtains `/hunt-event-permission`, travels, selects targets, and reports participation.
6. `runtime/coordinator/events/observations.ts` records event sessions and starts the saved-activity return. Hunt and merchant services consume that ownership.

The runtime also needs changes. `eventIsSupported` currently permits joinable events and Snowman. `activeCombatEvent`, `rawServerLiveEvents`, and `eventScheduleSnapshot` read `status[eventId]`; Halloween's boolean season flag does not contain its bosses. `eventMonsterTypes('halloween')` finds neither a monster named `halloween` nor one named `candy0`.

Adding Halloween only to the UI support list would produce a selectable checkbox without working attendance.

## Design decision

Keep `halloween` as the sole selection, permission, session, and recovery ID. Treat `mrpumpkin` and `mrgreen` as encounters within that activity. Switching between them must not capture a new pre-event checkpoint or start a return between bosses.

Use a small TypeScript adapter for feed normalization and a coordinator-owned encounter commitment for each attendance group. The coordinator chooses once and publishes that boss to the leader and followers. Independent characters have separate commitments. A participating merchant can prefer the party's committed boss while retaining independent opt-in and safety checks.

Two shapes were considered:

- **Client-only selection:** map `halloween` to both status keys and let every character sort its own feed. This is smaller, but different feed samples can send followers to different maps. Existing grouped farming combat explicitly excludes event-owned characters, so its target lock cannot solve that disagreement.
- **Coordinator encounter commitment, chosen:** normalize native observations at the character boundary and choose the encounter in `runtime/coordinator/events/`. Reuse existing attendance, travel, and recovery services. Add no separate movement or combat scheduler.

Proposed modules and contracts:

- `runtime/events/halloween.ts`: normalize seasonal state and boss reports, expose boss types, and rank valid candidates. Derive game fields from `typed-adventureland`'s `SEventsInfos` and monster/map types. Keep the application report envelope local.
- `runtime/characters/halloween.ts`: expose the adapter through the existing global integration pattern. Import it before `characters/shared.js` in `runtime/characters/common.ts`.
- `runtime/coordinator/events/halloween.ts`: own encounter selection and retention for each event-policy source and realm. Publish a discriminated state: `idle`, `waiting`, or `attending`, with an encounter present only for `attending`.
- Native observations carry boss type, live state, HP, maximum HP, destination, realm, and feed freshness. Validate this wire data at status ingestion. Optional native entity IDs strengthen encounter identity when available; the server feed does not always provide one.
- Report raw boss observations independently of the current commitment. Otherwise selection would wait for a report that the client emits only after selection, and detecting the second boss would depend on the first attendance ending.
- An attendance commitment carries its source, realm, boss type, destination, and generation. Propagate it through heartbeat responses. Bind any route to that generation and the existing navigation revision, so a delayed old-boss route cannot replace the new one.

Persist the commitment alongside existing event state through `runtime/coordinator/events/initial-contracts.ts` and `runtime/coordinator/persistence/snapshots.ts`. On restart, reconcile it against the admitted event session and fresh native observations before authorizing movement. Do not persist a report and treat it as fresh after restart.

## Implementation stages

### 1. Normalize the feed and select one encounter

Add the adapter and coordinator commitment before enabling the UI option.

- Distinguish **season active** from **boss available**. A boolean `S.halloween` alone never pauses Hunt or reserves merchant work.
- Read both boss status keys. Accept reported destinations only with a valid map and finite coordinates. When a live boss report lacks coordinates, derive its own special-spawn bounds from current `G.maps`. Never substitute the character's current position.
- Initially choose the lowest `hp / max_hp` among live Halloween bosses, with a stable type tie-break. Use valid native maximum HP, then the current monster definition if needed. Invalid HP must not produce `NaN` ordering.
- Retain the selected boss while it remains live. Rechoose when it dies or disappears beyond the existing grace period. This intentional difference from the backup avoids travel oscillation.
- Followers consume the committed encounter instead of choosing independently. Stale or missing authority holds new travel; it does not authorize a follower to choose another boss.
- Reconstruct after reload without treating standing on the `halloween` map as proof of attendance. That map also supports ordinary farming.

### 2. Connect attendance, combat, and recovery

Update the narrow integration points in `characters/shared.js`: `eventIsSupported`, `eventMonsterTypes`, `activeCombatEvent`, `rawServerLiveEvents`, `eventDestination`, `pollEvents`, `nearestEventTarget`, and respawn reentry.

- Report `activeEvent`, `joinedEvent`, and `serverLiveEvents` under `halloween`. Here `joinedEvent` is the existing attendance marker; never call `join('halloween')`.
- Travel through `sharedPartyWalk(..., 'event', 'halloween', ...)` to the committed destination. Preserve permission, Cave protection, protected Hunt turn-in, navigation revision, and manual cancellation checks.
- Restrict voluntary boss selection to the committed boss type and visible living entities in the same map and instance. Keep the party on the same encounter.
- Continue existing class skills, healing, potions, terrain-aware movement, and loot. Preserve defense against actual attackers and check spawned `jr`/`greenjr` adds with existing area-attack safeguards. Do not copy the backup's pull loop or Franky's special no-kiting policy.
- Extend status ingestion/response types and application wiring only for the new observation and commitment. Feed normalized liveness into existing observations, Hunt interruption, merchant reservation, and recovery.
- When another Halloween boss remains available, finish the current encounter's observable combat/loot departure and travel to the next boss under the same saved session. When neither remains, use the existing ten-second missing-event grace and saved-activity return. Party hints must not refresh raw liveness indefinitely.
- On deselection, revoke voluntary targets and travel promptly. Capture all now-disabled actual participants, preserve their waypoints, and retry failed `/event-disabled` notifications. Do not require boss death.
- Respawn uses normal event permission and travel recovery. Revalidate selection, realm, commitment generation, and current ownership before resuming.

Merchant behavior must preserve its safe work checkpoints and current equipment. For these two bosses, adopt the reference's rule that another character must hold aggro before merchant travel/attack. If that protection disappears, release voluntary offense and use existing defensive/return behavior. Do not silently equip a gun or enable unrelated events.

### 3. Enable and describe the checkbox

- Add `halloween` to `dashboard/lib/event-policy.ts`. Keep the existing checkbox and follower inheritance in `event-selection-control.tsx`.
- Make `eventScheduleSnapshot` retain one Halloween row while deriving combat availability from both bosses. Use native spawn/next timestamps only when valid; never invent a daily schedule for this seasonal event.
- Show whether a boss is available or the active season is waiting for one. Add only the small schedule/status field needed for that explanation and give the checkbox an accessible label.
- Preserve existing explicit arrays, including empty arrays. Do not add Halloween to saved selections automatically. Keep the legacy boolean Events-on path expanding to all supported combat events, including Halloween.
- Regenerate shared policy artifacts through `tools/build-shared.mts --publish`. Do not edit `dashboard/lib/event-policy.cjs` by hand; the coordinator consumes the installed generated copy.
- Update `docs/events-and-anniversary.md` and the coordinator README with actual behavior.

### 4. Build and activate

Publish shared policy, coordinator, and character artifacts through supported build tooling. Use the ordinary full `scripts/start-console.ps1` restart because character logic changes; `-CoordinatorOnly` cannot activate the complete feature.
