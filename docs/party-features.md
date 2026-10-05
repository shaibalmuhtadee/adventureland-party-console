## Party Console and shared banking

### Lone rogue crab farming

Select only Tiny Crab (`crab`) as the rogue's monster focus and choose its spawn
region. With no other non-merchant party member or assigned farming participant,
the rogue starts at that region's center and casts `fanofknives` at up to five eligible
crabs whenever the shared attack cooldown and mana permit. Merchants do not count
against solo farming. This behavior applies to any rogue, including OperativeAce.

When at most two eligible crabs are in range, it checks nearby walkable positions
inside the region. It moves only for at least two additional targets, preferring
the shortest trip for equal coverage and counting at most five targets. Travel
uses the remaining attack cooldown plus at most 250 ms, capped at one second.
Ready casts wait at most 250 ms for a better batch. Movement rechecks live crabs
and stops once three are reachable or the trip no longer improves coverage.
It holds the resulting position rather than returning to center after each cast.
Crabs expected to die to projectiles already in flight do not count as new targets.

When `citizen0aura` is absent, movement temporarily prioritizes the nearest
reachable entry into Kane's 320-unit aura, using native rectangle distance.
The rogue keeps casting Fan of Knives and stays inside until the buff appears,
then resumes normal farm positioning. Active buffs impose no movement boundary
or return timer. Terrain alternatives are sampled when the nearest entry is
blocked; Kane's last observed location is retained if he leaves client visibility.

This farm uses MP potions below 80% MP, with HP potions below 50% taking priority.
Keep `mpot1` stocked and enable MP restocking if needed. Fan of Knives requires
level 65 and an equipped `knifebelt`. The farm reserves attack cooldowns for that
skill instead of using basic attacks or other rogue damage skills. Travel,
events, rare encounters, a different monster focus, or another fighter restore
ordinary behavior. Verify center holding, repeated casts, potion consumption,
and leaving solo mode manually in game.

### Merchant logistics

Choose your logistics merchant in the dashboard. Its queue, active job,
per-character monster focus, potion policies, gathering mode, and last 500 activity entries are
persisted by caracAL, so rebooting does not discard pending work.

- **Send merchant to party** queues one visit per online non-merchant character; the bank action
  on a character card queues a visit to only that character.
- A visit collects all of that character's carried gold plus items marked for banking. Requested
  bank items, target gold, and potion restocks are delivered without being swept back up. Upgrade
  and compound marks are transferred to the merchant, processed
  with the appropriate scroll, and successful results are returned. Mass Production is used when
  the merchant has learned it.
- **Mark for bank** sends an item through the merchant into bank storage. **Mark for merchant**
  sends it to the merchant and leaves it in the merchant's inventory. These dispositions are
  mutually exclusive and persist until the item is successfully handed off.
- **Auto mark for bank** and **Auto mark for merchant** persist an item-name rule for that
  character. Every matching stack acquired later receives the selected mark automatically,
  including after the previous stack has already moved. Selecting the other destination replaces
  the previous automatic rule.
- Automatic cleanouts use normal stack-aware bank placement: compatible bank stacks fill first,
  followed by the first empty slot across the available packs. Overflow loot is no longer forced
  into `items1`.
- Each card has an independent monster-focus picker. It applies while **Follow leader** is off;
  followers continue using the leader's combat target.
- HP restocking defaults to min 5 / max 20 of `hpot1`. MP restocking defaults to disabled (0 / 0)
  using `mpot1`. Both are configurable per character.
- Mining and fishing modes persist, pause for queued logistics, and resume afterward. Game level,
  MP, tool, cooldown, and location requirements still apply; failures are logged.

Both characters must be online in the same realm for a delivery. Otherwise the job remains queued.

Each active character sends a sanitized status snapshot to the Party API;
the Adventure Land session is never sent to the webpage. The Party Console shows
health, mana, location, gold, equipment data, and inventory. Right-click an item to
equip it or toggle **Mark for bank**, and use the full-width **Send party to bank**
button beneath the character cards to queue every active character.
Party bank jobs remain queued until each character reports completion; they are not
discarded merely because one status response was sent. Characters waiting for the
single available bank slot pause combat and leader-following, and the dashboard
labels them **BANK QUEUED**.
Each character card also lists every live Adventure Land status condition beneath
HP/MP. Click a status for its description, remaining duration, stacks, source, and
the complete condition properties reported by the game.
The inventory menu also has **Give to...** for transferring the full item stack to
another online party member (the characters must be close enough for Adventure
Land's `send_item` action).

Open **Inspect bank** and right-click an item to choose **Withdraw to...**. The
request stays queued until that character's next bank visit. The character verifies
the live bank slot, searches for the same item if its cached slot moved, withdraws
it, and clears the completed request. An amber bank-slot border indicates a queued
withdrawal; choosing the same character again unmarks it.

The last bank snapshot and all pending withdrawal requests are persisted in
caracAL's ignored local data store under `.caracal/localStorage`. They survive
coordinator reloads, stopping the launcher, and Windows restarts. No Adventure Land
session or authentication value is included in this Party Console state. Deleting
the `.caracal` directory also deletes this local cache.

Party settings are persisted in the same local store: bank threshold, deposit-item
marks, party location, leader, each character's **Follow leader** setting, and
the multi-select monster focus. The focus picker shows each monster's in-game
sprite and supports any combination of checked monster types, plus an exclusive
**All monsters** option. Independent hunters choose the nearest matching monster.
Followers use the leader's selected combat target. They also move
toward the leader whenever they are on a different map or more than 200 game units
away, before resuming shared-target combat.
The leader keeps its current living target, then prioritizes monsters attacking a
non-leader party member before selecting a fresh farming target. This defensive
"tank" priority can override the monster-focus filter, and followers may assist the
leader with that defensive target.
The follow checkbox is retained even while that character is the leader, making
leader swaps preserve each character's preferred follower behavior.

Characters also perform shared overlap avoidance before following or selecting a
combat target. If same-map party members are within 16 units, one stays in place
and the others move to deterministic offsets. This avoids everyone reacting at
once and includes a short cooldown to prevent position jitter.

The shared routine also monitors the 400-HP potion `hpot1` (100 gold each). When a
character reaches zero, has at least 2,000 gold, and is not banking, it travels to
`fancypots`, buys 20, and returns to its prior position. If it cannot yet afford the
restock, it stays in place and retries every five seconds as its gold increases.
Combat and leader-following pause during the trip; the dashboard shows
**STOCKING UP**.

Upgradeable inventory and equipped items have a **Mark for upgrade** submenu that
selects how many tiers to attempt, capped at the game's +12 maximum. Equipped
items are unequipped into inventory when their upgrade run begins. Marks
are persistent and tied to the real inventory slot, allowing identical items to be
selected independently. **Send party for upgrades** serializes marked characters
through the shared bank lock. Each character calculates the required scroll grade,
withdraws a gold shortfall from the bank when necessary, buys missing scrolls from
`scrolls`, travels to `newupgrade`, logs each preview chance, and performs the
requested attempts in order. **Buy another level 0** queues a merchant copy of a
known purchasable item into that same persistent run. Completed attempts and items no longer present are
unmarked; insufficient combined character/bank gold leaves the marks for a later
run.

Armor equipment with a game-defined **Stat** attribute also has **Add primary-stat
scroll** in its right-click menu. The request is persisted and chooses STR, INT,
DEX, or VIT from the wearer’s class. Before the merchant leaves town for any
service visit, it retrieves existing matching stat scrolls from the bank and buys
the remaining grade-dependent quantity, then delivers them to the wearer. The
wearer travels to the upgrade shrine fully equipped, then unequips, scrolls, and
immediately re-equips one marked piece at a time before processing the next.
Applied equipment shows its `stat_type` in the companion UI and cannot be marked
for another primary-stat scroll. Merchant’s Luck upkeep trips use this same
exchange path, including deliveries and collection of gold and bank/merchant-marked
items.

Per-character travel, bank, and upgrade commands stop that character from acquiring
new monsters. The character finishes its current target and any monster actively
attacking it before departing, so movement does not abandon an in-progress fight.
Followers more than 150 units from their leader use `smart_move`, including cross-map
routing, instead of direct movement.

Right-click the gold balance in **Inspect bank**, choose **Withdraw to...**, and set
a persistent target balance for that character. The merchant first sweeps the character's
existing gold, then delivers the requested walking balance after collection.

The same persistent target is available directly beside every character's current gold.
Edit **Set target amount**, then use the adjacent bank icon to queue that character's exchange.
The merchant has its own target too; its bank deposits stop at that balance instead of emptying
the merchant completely.

Item detail dialogs combine the base game definition with Adventure Land's calculated
item properties, so upgraded and special items display their actual current stats.
Right-click an occupied equipment slot on the character doll to unequip that exact
item into the character's inventory.

Each character card has individual controls beneath its inventory. **Send party
member to bank** runs that member's serialized bank actions, **Send party member to
town** safely travels to `main [-174, 121]`, and **Return to leader** safely
smart-moves back to the current leader before normal combat resumes.

The bank threshold defaults to 100,000 gold and is editable in the page. When any
character exceeds it, every character seen in the last ten seconds is added to a
serialized bank queue. One character at a time travels to the bank, deposits all
carried gold and marked items, returns to its previous map and coordinates, and
then releases the bank slot to the next character. Items are identified
again immediately before equip/store actions, so stale inventory slots are never
trusted. Dashboard settings and marks are currently in memory and reset when
caracAL restarts.

The Party Travel panel sets a shared rally point by map and coordinates and sends
every active character there. Bank runs return to this rally point. Each character
card also has a mutually exclusive **Leader** radio button and a **Follow leader**
checkbox. Followers attack the leader's currently published goo target and wait
when that target is not visible, rather than selecting their own nearest monster.

Inventory cells use Adventure Land's deployed sprite-sheet coordinates. Left-click
an item for its description and definition stats; right-click still opens equip and
bank actions. Travel choices are populated with the same deployed-map filters as
the game's **Travel → Places** menu. **Party monster focus** selects any deployed
monster type, while **All monsters** uses the nearest valid monster without a type
filter. **Find monster** chooses a known spawn for the selected focus and sends the
whole party there through `smart_move`, including routed cross-map travel. Followers
always inherit the leader's exact target within that focus.

