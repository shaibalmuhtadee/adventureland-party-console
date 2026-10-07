import type {CharacterAppearance} from "../status/character-appearance.ts";
import type { RosterOwnership } from "../../roster/handoff.ts";
import type { Lifecycle } from "./types.ts";

interface SavedRoster {
  characterHomeRealms?: Record<string, string>;
  characterAppearances?: Record<string, CharacterAppearance>;
  headlessSlots?: RosterOwnership["slots"] | null;
  steamSwitch?: RosterOwnership["handoff"];
  nativeOwner?: string | null;
  steamMembers?: string[] | null;
}

/** Preserve explicit saved slots; only installations without them inherit enabled workers. */
export function initialHeadlessSlots(
  saved: SavedRoster,
  workers: Record<string, { enabled?: unknown }>,
): RosterOwnership["slots"] {
  const slots = Array.isArray(saved.headlessSlots)
    ? saved.headlessSlots.slice(0, 4)
    : Object.keys(workers)
        .filter((name) => workers[name].enabled)
        .slice(0, 3);
  while (slots.length < 4) slots.push(null);
  return slots;
}

/** Keep legacy native-owner migration without deduplicating or rewriting saved Steam membership. */
export function initialSteamRoster(saved: SavedRoster): {
  characterHomeRealms: Record<string, string>;
  characterAppearances: Record<string, CharacterAppearance>;
  lifecycle: Record<string, Lifecycle>;
  steamSwitch: RosterOwnership["handoff"];
  nativeOwner: string | null;
  steamMembers: string[];
} {
  return {
    characterHomeRealms: saved.characterHomeRealms || {},
    characterAppearances: saved.characterAppearances || {},
    lifecycle: {},
    steamSwitch: saved.steamSwitch || null,
    nativeOwner: saved.nativeOwner || null,
    steamMembers: Array.isArray(saved.steamMembers)
      ? saved.steamMembers
      : saved.nativeOwner
        ? [saved.nativeOwner]
        : [],
  };
}
