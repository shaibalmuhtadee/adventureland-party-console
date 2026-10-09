# Party Console metrics

Metrics switches the workspace from character cards to historical graphs. The
header stays visible. The right navigation button opens Metrics; the left button
returns to characters. The transition respects reduced motion. Each view retains
its filters and page position. Dialogs remain outside the translating workspace.

## Collection and activation

Character collection is independent of an open dashboard. Updated characters
report compact measurements to `POST /party-api/metrics`. The coordinator stores
history beside its ordinary JSONL store, in `<LOCALSTORAGE_PATH>.metrics.jsonl`.
Clearing combat logs does not clear metrics. Existing logs are not backfilled.
Metrics storage failures leave ordinary party coordination running and expose
an unavailable metrics endpoint. The original history is preserved.

This feature changes character assets, the coordinator, and the dashboard.
Activation therefore requires the ordinary full supported start-console workflow
described in `runtime/coordinator/README.md`. A coordinator-only restart does not
publish the character collector. Source edits do not activate generated assets.

Run `npm run typecheck` after implementation changes. Gameplay verification,
E2E testing, builds, and process restarts remain with the user unless requested.

## Definitions

- Kills count observed party monster deaths once. Native attacker attribution is
  separate from the reporting character. Healer/tank observations cannot inflate
  party totals. Native shared credits remain separate and are never added as
  party deaths. Credits without corresponding observed death evidence mark
  their interval incomplete.
- DPS sums native outgoing monster damage for tracked characters. Attack stats
  are not used as a damage estimate. Damage by other players needs their telemetry.
- Gold history samples character balances plus a persisted internal-movement
  offset. Confirmed gold sent to another owned character or deposited in the
  bank adds to that offset; received gold and bank withdrawals subtract from it.
  Collection and banking therefore preserve net profit, including when viewing
  only the fighter. Spending, sales, donations, mail and external transfers still
  affect profit. It is not classified farming income.
  Each character starts at its first observed balance since the last graph reset.
  Gold has its own range, independent of the shared time filter, up to the
  180-day retention limit. Its reset time is saved per account in this browser.
  Disconnected characters retain their last known gain; joining characters do
  not add their existing wealth as income. The offset survives CODE reloads,
  disconnects, collector retries and coordinator restarts. Older history lacks
  transfer evidence and cannot be corrected retrospectively. Bank balances and
  transaction categories are not shown separately.
- Total account gold records the same bank plus active-slot carried balance as
  the header every ten seconds in the coordinator, even with the dashboard closed.
  Bank storage characters are excluded, matching the header. Unknown balances
  remain gaps. Collection starts when this feature is activated; older account
  balances cannot be backfilled. History survives coordinator restarts and is
  retained for 180 days, with older samples downsampled. Its display reset is
  saved per account in this browser.
- Items acquired counts quantities in native chest outcomes for each recipient.
  Transfers, purchases, banking, exchange rewards and production are excluded.
  Item level and native property/stat variants are retained independently.
- Raw `luckm` remains available to the drop estimator. Ping uses native samples.
  There is no Luck history graph.
- Rates use elapsed time, including observed travel and downtime. Telemetry gaps
  are missing measurements, not zero activity. Partial history can undercount.

## Graph controls

The shared toolbar selects a range, characters and server.
Live advances the displayed range; pausing leaves collection running.
Custom ranges are fixed and limited to 180 days. Reset restores the shared and
graph filters. Historical disconnected characters remain available.

Kills and DPS have separate searchable monster filters. DPS also filters skills
and groups bars by character or skill. Items acquired has a searchable item filter
and rate units. Gold shows cumulative net gold gained with a character selector.
Loot breakdown shows all acquired items as horizontal bars, with scrolling when
needed. It defaults to today in America/Toronto and offers yesterday, a selected
day or an inclusive date range. Calendar boundaries follow EST/EDT automatically.
It ignores the shared time range and temporary item resets so selected days keep
their complete loot totals. Its reset button restores today's date filter.
There is no Damage breakdown graph. Ping shows a time series.
Cards use a uniform 460-pixel height in two desktop columns and one mobile column.
Each card has one header with its title, optional counter and Options button.
Filters, scales, character-series selection and reset live in that menu.
The estimator searches catalog names, IDs, sets
and item types, with sprite results and keyboard selection.

Charts retain quantity units and tick values, with no generic X-axis titles or
footer legends. Only major grid lines on the value axis are drawn. Line segments
do not bridge missing observations. Options toggles character lines and shows
their colors. Ping always shows separate series for currently logged-in console
characters, subject to the shared character/server filters.
Suitable positive graphs offer logarithmic Y scales; zero values become gaps
in that view, and negative values disable logarithmic scaling.

Metrics has no expand, data download or export controls. Drop-projection
milestones and assumptions are available in its Options menu.

Kills uses vertical bars by monster. Bar height counts kills in the selected
time range. The second line beneath each monster name shows its total recorded
kills across retained history, subject to character/server filters and resets.
Rate labels above the bars average the selected range and normalize to 15
minutes, 30 minutes, an hour, or a day. They use the actual collection/reset
start when it is newer than the chosen range. Rare monsters keep meaningful
averages between spawns rather than creating short-bucket rate spikes.

The top-right kills counter totals the current calendar day in the browser's
local timezone. It respects the selected monsters, characters, and server,
independently of the time range chosen for the bars. The searchable monster
filter supports multiple choices, including monsters with zero recent kills.
With many monsters selected, the plot scrolls horizontally to keep labels legible.

DPS uses vertical bars showing average damage per second over the selected range,
with retained damage totals below each character or skill and DPS labels above.
Its top-right counter shows today's filtered damage. Items acquired uses vertical
quantity bars by item, with retained item totals below and selected-range rates
above. Its top-right counter shows today's filtered acquisitions. Both charts
offer logarithmic scales and scroll horizontally when needed.
The active view refreshes once a second, and characters deliver sealed frames
once a second. History still uses bounded 10-second buckets; the newest bucket
updates as each frame arrives.
Gold charts request history every ten seconds. Gold reads include only balance
endpoints and internal-movement offsets, and yield between historical batches
so a long range cannot monopolize coordinator processing. The account-total
counter still follows the header's live core updates.

## Resets

Each graph has a reset button. Kills and credits are permanently erased together.
DPS permanently erases damage history. These
durable cutoffs prevent older queued frames from restoring deleted data.
The append journal is compacted after deletion, and interrupted erasure resumes
from its persisted checkpoint. Ingestion waits in the character outbox during
the erasure so new observations cannot race with cleanup.

Gold, Total account gold, Items acquired, and Ping resets temporarily clear the
display. Stored measurements remain available through Reset filters. The last
received partial bucket is subtracted so old quantities do not immediately
reappear. Reset data permanently clears kills/damage and temporarily clears
the other recorded graphs. Resetting the estimator restores its inputs and
clears the generated curve; a projection has no stored history to erase.

## Drop projection

Select an item and direct monster source. Kills/hour defaults to the observed
rate for that monster and selected scope, with an optional manual override.
Luck defaults to a displayed character observation, with an optional override.
The options menu selects the luck character and manual overrides.
The estimator offers Linear, Log X, and Log Y scales. Zero kills/hours are
omitted from Log X; zero probabilities are omitted from Log Y.

The direct-table model uses:

`p_roll = min(1, base_rate * luckm * share * monster_level * monster_modifier)`

Ordinary luck buffs are already included in native `luckm`. Lone Wolf, New
Player and Welcome Back use the separate native Encouragement total instead.
The collector retains that multiplier, and the live estimator also reads active
condition multipliers from the character's existing vitals cache.

The bonus roll uses:

`p_bonus = min(1, base_rate * luckm * contribution * (encouragement - 1) * monster_level * monster_modifier)`

For `r` ordinary rolls and the independent bonus roll:

`p_kill = 1 - (1 - p_roll)^r * (1 - p_bonus)`

Average kills to the first drop are `1 / p_kill`. At least one drop after `n`
kills has probability `1 - (1 - p_kill)^n`. Target-probability thresholds round
up to whole kills. Hours divide those kill counts by kills/hour. Expected item
quantity is `(r * p_roll + p_bonus) * quantity_per_reward` per kill.
This keeps the bonus separate and avoids counting ordinary buffs twice.

The default assumptions are full share, level 1, modifier 1 and one ordinary roll.
Automatic contribution uses the character's fraction of tracked outgoing damage
against the selected monster. The contribution override handles healing and
untracked contributors. An observed bonus is a projection of current conditions;
the server's exact encounter ledger can change during a fight.
Advanced controls expose those assumptions. They are scenarios, not inferred
live party mechanics. A character's luck cannot be silently treated as the
party's combined drop chance. The catalog source must have a supported direct
single-roll base rate. Indirect, zone, world, multi-drop and special home/event
tables need separate models.

The native direct-table calculation and recipient-bearing chest events were
inspected in the pinned upstream server source used by this repository:
[server.js](https://github.com/kaansoral/adventureland_mongodb/blob/90052162eb3ebda36c893e1eb4af643913c8f984/node/server.js).
The separate contribution-weighted bonus is documented in current upstream
[encouragement.js](https://github.com/kaansoral/adventureland_mongodb/blob/main/node/logic/encouragement.js).
Source inspection is not a live gameplay verification. Older metric samples
remain compatible; they omit the newly captured Encouragement multiplier.

## Delivery and retention

The character batches measurements, seals frames approximately every one
seconds, and journals pending frames through its persistent CODE storage. The
outbox retains at most 720 frames, about twelve minutes at normal cadence.
Older lost/expired data marks subsequent coverage incomplete. An unsealed
frame can lose up to about one second on an
abrupt runtime termination. Collection ends with its CODE generation.

Each accepted frame writes measurements and its retry receipt in one bucket
record. A lost HTTP acknowledgement can resend the same frame without adding
its measurements again. Party death/chest identities are scoped to server,
map/instance and native IDs, with short-lived death deduplication to accommodate
native IDs being reused after a server restart.

History retains 10-second buckets for 24 hours, 1-minute buckets for 30 days,
and 15-minute buckets for 180 days. Rollup checkpoints are written before source
deletion so interruptions can resume without adding the same source twice.
Rollups preserve sums, sample counts, exposure and chronological balance
endpoints. Queries align ranges to stored buckets and return roughly 600 points.
Resolution cannot recover details already merged into older buckets.

`GET /party-api/metrics?from=<epoch_ms>&to=<epoch_ms>` returns the versioned
metrics contract, collection start, resolution, available characters/servers,
coverage status and points. Optional comma-separated `characters` and `servers`
filter rows and death attribution. Dashboard requests stop when Metrics is
hidden or the browser is not visible.

`GET /party-api/metrics/kills` accepts the selected `from`/`to` range and the
calendar day's `dayFrom`/`dayTo`, plus optional `characters`/`servers` filters.
It returns per-monster selected-range counts, retained totals and daily counts.
Retained totals use an in-memory index rebuilt from durable buckets at startup
and updated after accepted deaths, expiry and resets. Range/day aggregates read
the existing bucket index rather than transmitting full history to the browser.

`GET /party-api/metrics/bars` accepts `metric=damage|loot`, grouping by
`by=character|skill` for damage, the same range/day windows, and optional
`characters`, `servers`, `monsters`, `skills`, and `items` filters. It returns
selected-range amounts, retained totals, daily counts and the elapsed duration
used for rate labels. Damage and loot totals have their own retained-history
index, maintained through ingestion, expiry and resets.

## Maintained source

- `runtime/characters/metrics.ts`: capture, outbox and retry lifecycle.
- `runtime/metrics/`: shared protocol and boundary parsers.
- `runtime/coordinator/metrics/service.ts`: ingestion, deduplication, storage,
  retention and queries.
- `dashboard/features/party/party-view-switch.tsx`: workspace navigation.
- `dashboard/features/party/metrics-*.tsx` and `metrics-series.ts`: graphs,
  filtering and projections.
- `dashboard/features/party/metrics-kills.tsx`: categorical kills, monster/rate
  filters, per-bar rates, retained totals and the daily counter.
- `dashboard/features/party/metrics-measurements.tsx`: DPS and acquisition bars.
- `dashboard/features/party/metrics-gold.tsx`: per-character balance baselines
  and cumulative net gold gains.
- `runtime/metrics/luck.ts`: native Encouragement parsing and the independent
  ordinary/bonus drop model.

Later additions can extend acquisition sources and transaction attribution,
bank history, XP transitions, death/activity breakdowns and event-specific drop
models without relying on human-readable combat log messages.
