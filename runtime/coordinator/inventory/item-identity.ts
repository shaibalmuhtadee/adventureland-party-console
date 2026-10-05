import type { Item, ItemMark } from "../contracts/item.ts";

const transientProperties = new Set(["q", "price", "rid", "b", "giveaway"]);

export function markedItem(entry: ItemMark | null | undefined): Item | null | undefined {
  return entry?.item && Number.isSafeInteger(entry.slot) ? entry.item : entry;
}

/** Marks are partial identities; a changing stack quantity does not invalidate them. */
export function sameMarkedItem(
  first: Item | null | undefined,
  second: Item | null | undefined,
): boolean {
  if (!first || !second) return false;
  return Object.keys(second)
    .filter((key) => !transientProperties.has(key))
    .every((key) => JSON.stringify(first[key]) === JSON.stringify(second[key]));
}

export function autoItemRuleKey(item: Item | null | undefined): string {
  return typeof item?.name === "string"
    ? item.name + "@+" + Math.max(0, Number(item.level) || 0)
    : "";
}

export function autoItemRuleMode<T>(
  rules: Readonly<Record<string, T>>,
  item: Item | null | undefined,
): T | undefined {
  if (!item) return undefined;
  const explicit = rules[autoItemRuleKey(item)];
  if (explicit) return explicit;
  // Older name-only rules apply to +0, never to an upgraded item.
  return (Number(item.level) || 0) === 0 ? rules[String(item.name)] : undefined;
}

export function automaticCommerceRuleKey(item: Item | null | undefined): string {
  return JSON.stringify({
    name: item?.name || "",
    level: Math.max(0, Number(item?.level) || 0),
    p: item?.p || null,
    stat_type: item?.stat_type || null,
  });
}

/** NPC sale policies apply to every variant of the game item ID. */
export function automaticNpcSaleRuleKey(item: Item): string { return String(item.name); }
