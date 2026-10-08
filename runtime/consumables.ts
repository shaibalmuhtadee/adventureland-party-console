/** Elixirs occupy the native elixir slot until their server-provided expiry. */
export function isRenewableConsumable(definition: unknown): boolean {
  return !!definition && typeof definition === 'object' &&
    'type' in definition && definition.type === 'elixir' &&
    'duration' in definition && typeof definition.duration === 'number' &&
    Number.isFinite(definition.duration) && definition.duration > 0;
}

/** One elixir can be active per character, so each character selects one item ID. */
export type AutoConsumables = Record<string, string>;
