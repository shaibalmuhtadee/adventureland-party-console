interface SelectionState {
  merchantCharacter: string | null;
  eventSelectionsByCharacter: Record<string, unknown>;
  eventsByCharacter: Record<string, unknown>;
}

/** Explicit event selections, including empty arrays, override legacy enable flags. */
export function migrateCharacterSelections(
  state: SelectionState,
  workers: Record<string, unknown>,
  supportedEvents: readonly string[],
): void {
  for (const name of new Set(
    [...Object.keys(workers), state.merchantCharacter].filter((name): name is string => !!name),
  )) {
    if (Object.prototype.hasOwnProperty.call(state.eventSelectionsByCharacter, name)) continue;
    const otherEvents =
      state.eventsByCharacter[name] && name !== state.merchantCharacter
        ? supportedEvents.filter((id) => id !== "anniversary")
        : [];
    state.eventSelectionsByCharacter[name] = ["anniversary", ...otherEvents];
  }
}
