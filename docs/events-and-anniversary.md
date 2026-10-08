# Event attendance

Halloween selects Mr. Pumpkin and Mr. Green on the current realm. The seasonal
flag alone does not interrupt ordinary activity. The coordinator commits one
boss per attendance group, initially choosing the lowest HP fraction and keeping
that choice until a scheduled spawn enters its preparation window. Followers share that choice; independent characters
keep their own attendance. Characters walk to the reported boss map rather than
calling `join`. Mr. Pumpkin normally spawns on Halloween and Mr. Green on
Spookytown. Short feed gaps, remaining attackers, and pending loot delay a boss
switch. After a walking leg finishes, a moved boss can supply a new shared
destination without changing the encounter.
Seeing a boss does not cancel the shared walking leg. After shared arrival,
each character closes any remaining gap to its visible target until the native
attack-range check succeeds, using the target's current position if it moves.
The same approach applies to independent attendance and respawn reentry.
When the server announces either boss's next spawn, enabled characters start
travelling to its registered spawn area with 120 seconds remaining. They wait there
without acquiring the absent boss as a combat target. The live spawn retains the
preparation route's generation and then hands off to normal combat. If the live
report is delayed, preparation holds for up to 30 seconds past the announced time.
Missing or stale timing does not trigger travel. Rescheduled spawns and deselection
use the existing cancellation and saved-activity recovery flow.
When neither boss remains, the existing event recovery resumes farming or Hunt.
Unchecking Halloween returns actual participants while the boss may remain alive.

During Mr. Pumpkin attendance, visible living `jr` adds take priority over the
boss. Their appearance replaces an engaged Mr. Pumpkin target; once no eligible
`jr` remains, the selector resumes the boss. Adds stay within the current map and
instance and do not change the coordinator's committed encounter or travel route.
Merchants retain the requirement that another character holds their target's aggro.

A rogue with no other non-merchant members in the actual party engages Mr. Pumpkin
or Mr. Green only while that boss targets another character. Off-map party members
still count. Preparation before a spawn remains available; an untargeted boss or
one targeting the rogue pauses approach and boss damage until another tank takes
over. The rule covers basic attacks and offensive skills, including Fan of Knives.

During Mr. Pumpkin combat, rogues use Fan of Knives on every ready attack in the
77–72%, 52–47%, and 27–22% HP windows around his add spawns. Nearby `jr` take the
first target slots, with Mr. Pumpkin filling a remaining slot, up to the native
target limit. Knives continue while eligible `jr` remain in skill range, then
ordinary boss damage resumes outside those windows. Equipment, mana reserve,
immunity, and the shared attack cooldown still apply.

The merchant's Events dropdown has an **Attack during events** checkbox, off by
default. It controls combat attendance for all selected events, including
Halloween, while preserving those selections. Enable it when the merchant is
equipped for combat. Turning it off during attendance stops attacking and uses
the existing event return flow. The setting persists across restarts and dashboard
export/import. Anniversary activities do not require this combat toggle.

Enabled merchants attend only while another character holds the boss's aggro, retain
their current weapon, and yield inventory work at existing safe checkpoints.
Loss of that aggro protection requests the merchant's own event return.
Server hopping, Slenderman hunting, and candy exchanges are not part of attendance.
Gameplay verification is manual in game.

Each character's Events dropdown selects individual supported activities. Followers use the leader's whole selection; their saved choices return when they unfollow. Merchants keep independent selections and can attend every supported event. During combat events they attempt attacks with their currently equipped weapon, including Golden Gun; no automatic weapon swap is performed. Merchant work yields at safe production/crafting checkpoints, while other in-flight actions finish before travel. Gathering, new jobs, and stand activity remain paused through event attendance and return. Unsupported game events remain visible with disabled checkboxes.

Unchecking an attended event requests the existing saved-activity return. Cancellation requests retry after coordinator outages. Legacy combat settings migrate to the equivalent supported combat list, with Anniversary initially enabled to preserve prior behavior.

Schedule rows use browser-local date formatting, including a timezone label. Only server-provided next timestamps produce countdowns. Unknown schedules are labelled explicitly. Game-server clock offset is sampled on connection and every five minutes; cached event checks do not create additional game-server requests.

Anniversary departure begins 90 seconds before the next server deadline. Each character gets at most two reserved attempts per round, retained by the coordinator through reloads. The second approach uses the latest featured-player position. Movement is bounded to 60 seconds with a ten-second progress watchdog and independent arrival detection. Visibility, kiss response, and reward confirmation waits are also bounded by event expiry.

The first character to exhaust both attempts skips the remainder of the round for the party. The Anniversary modal's gear edits a persistent, case-insensitive player blacklist. Adding the current featured player skips the current round; removing a name does not reopen a skipped round. An empty list is preserved.

Relevant regression coverage: `event-selections`, `event-policy`, `anniversary-kiss`, `farming-navigation`, `merchant-anniversary-reservation`, and `hunt-event-priority` tests.

Franky attendance attacks only living, visible `franky` monsters in the current map
and instance. It retains the current boss when possible and waits without fallback
targets if the boss disappears. Every participating class approaches until in attack
range, then holds position; no kiting, retreating, formation movement, or warrior Dash
is used. Approaches respect terrain but ignore monster danger zones and healer
coverage. Offensive skills cannot target adds; area effects that cannot exclude them
are suppressed. Healing, potions, buffs, and nearby loot continue. Event exit and
manual navigation retain ownership, and the existing exit-defense policy is unchanged.

Validate with `franky-combat`, `combat-movement`, `class-skills`, `franky-recovery`,
and `franky-exit`; publish character assets with the full supported restart.

Deselecting Franky revokes voluntary boss targeting and installs the protected
exit convoy immediately; departure does not require killing the boss first.
The native evacuation journey verifies boss damage, deselection, both client
exit owners, and actual Mainland arrival while Franky remains alive.
