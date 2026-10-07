"use client";
import { RosterPicker } from "./roster-picker";
import type { PartyConsoleModel } from "./use-party-console";

export function PartyRosterPicker({ model }: { model: PartyConsoleModel }) {
  const { state, setPickerSlot, pickerSlot, switchSteam, spawn, setCreateOpen } = model;
  return (
    <RosterPicker
      key={pickerSlot ?? "closed"}
      slot={pickerSlot}
      slots={state.activeSlots || []}
      roster={state.roster || []}
      realms={state.realmControl?.realms || []}
      defaultRealm={state.realmControl?.homeRealm || state.realmControl?.activeRealm || ""}
      onHomeWorld={async (character, realm) => { await model.post("/roster/home-world", { character, realm }); }}
      onClose={() => setPickerSlot(null)}
      onCreate={() => {
        setPickerSlot(null);
        setCreateOpen(true);
      }}
      onChoose={(name, hosting, realm) => (pickerSlot === 0 ? switchSteam(name) : spawn(pickerSlot!, name, hosting, realm))}
    />
  );
}
