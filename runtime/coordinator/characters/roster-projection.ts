import { characterHomeWorld } from './home-world.ts';

export interface AccountCharacter {
  name: string;
  type?: string;
  level?: number;
  id?: string | number;
  online?: unknown;
  home?: string;
  server?: string;
}
interface Account {
  characters: AccountCharacter[];
  servers?: { key: string; players?: unknown }[];
}
interface RosterStatus {
  name: string;
  seenAt: number;
  server?: string;
  ctype?: string;
}
interface RosterState {
  characterHomeRealms?: Record<string, string>;
  bankbois: Record<string, unknown>;
  statuses: Record<string, RosterStatus | undefined>;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  nativeOwner: string | null;
  lifecycle: Record<string, string | undefined>;
  activeRealm: string;
  realmSwitch: unknown;
}
function observedServer(
  status: RosterStatus | undefined,
  character: AccountCharacter | undefined,
  cutoff: number,
): string | null {
  return status && status.seenAt >= cutoff && status.server
    ? "SR_" + status.server
    : (character && character.server) || null;
}
export function coordinatorRealmLabel(realm: string | null | undefined): string {
  return String(realm || "")
    .replace(/^SR_/, "")
    .replace(/^(US|EU|ASIA)(I|II|III|IV|V|PVP)$/, "$1 $2");
}

/** Project live account and session ownership without retaining an outdated account response. */
export function createRosterProjection(
  state: RosterState,
  account: () => Account,
  now: () => number,
) {
  function owned(name: unknown): AccountCharacter | undefined {
    return account().characters.find((entry) => entry.name === name);
  }
  function roster() {
    return account()
      .characters.filter((entry) => !state.bankbois[entry.name])
      .map((entry) => ({
        name: entry.name,
        ctype: entry.type,
        level: entry.level,
        id: entry.id,
        online: !!entry.online,
        home: entry.home || null,
        homeWorld: characterHomeWorld(state.characterHomeRealms?.[entry.name], entry.home, state.activeRealm),
        server: entry.server || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function homeRealm(): string | null {
    const home = (account().characters || []).map((entry) => entry && entry.home).find(Boolean);
    return home ? "SR_" + String(home).replace(/^SR_/, "") : null;
  }
  function headlessSlots() {
    return state.headlessSlots.map((name, index) => ({
      index: index + 1,
      kind: "headless",
      character: name,
      state: name ? state.lifecycle[name] || "offline" : "empty",
    }));
  }
  function slots() {
    const headless = headlessSlots(),
      occupied = headless.filter((slot) => slot.character);
    const steam = state.steamMembers.map((name, index) => ({
      index: name === state.nativeOwner ? 0 : 100 + index,
      kind: "native",
      character: name,
      primary: name === state.nativeOwner,
      state: (state.statuses[name]?.seenAt ?? NaN) > now() - 10000 ? "online" : "offline",
    }));
    const empty = headless
      .filter((slot) => !slot.character)
      .slice(0, Math.max(0, 4 - steam.length - occupied.length));
    return [...steam, ...occupied.concat(empty).sort((a, b) => a.index - b.index)];
  }
  function participants(): string[] {
    return Array.from(
      new Set(
        slots()
          .map((slot) => slot.character)
          .filter((name): name is string => !!name && !state.bankbois[name]),
      ),
    );
  }
  function observation(name: string, cutoff: number) {
    const status = state.statuses[name],
      character = owned(name);
    const server = observedServer(status, character, cutoff);
    return {
      name,
      ctype: status?.ctype || character?.type || null,
      realm: server,
      online: !!(status && status.seenAt >= cutoff),
    };
  }
  function realms() {
    return (account().servers || []).map((realm) => ({
      key: realm.key,
      label: coordinatorRealmLabel(realm.key),
      players: Number(realm.players) || 0,
      // Preserve the legacy regex semantics for account-supplied keys.
      // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
      pvp: /PVP$/.test(String(realm.key || "")),
    }));
  }
  function control() {
    const cutoff = now() - 15000;
    const observations = participants().map((name) => observation(name, cutoff));
    const combatRealms = Array.from(
      new Set(
        observations
          .filter((entry) => entry.ctype !== "merchant")
          .map((entry) => entry.realm)
          .filter(Boolean),
      ),
    );
    const merchant = observations.find((entry) => entry.ctype === "merchant") || null;
    return {
      activeRealm: state.activeRealm,
      currentRealm: combatRealms.length === 1 ? combatRealms[0] : null,
      homeRealm: homeRealm(),
      split: combatRealms.length > 1,
      characters: observations,
      merchantRealm: (merchant && merchant.realm) || null,
      operation: state.realmSwitch,
      realms: realms(),
    };
  }
  return { owned, roster, homeRealm, slots, participants, control };
}
