"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveSlot } from "./active-slot";
import { RosterMember } from "./roster-member";
import type { RealmOption } from "./realm-option";

export function RosterPicker({
  slot,
  slots,
  roster,
  realms,
  defaultRealm,
  onHomeWorld,
  onClose,
  onChoose,
  onCreate,
}: {
  slot: number | null;
  slots: ActiveSlot[];
  roster: RosterMember[];
  realms: RealmOption[];
  defaultRealm: string;
  onHomeWorld: (name: string, realm: string) => Promise<void>;
  onClose: () => void;
  onChoose: (name: string, hosting: "headless" | "steam", realm?: string) => Promise<void>;
  onCreate: () => void;
}) {
  const [hosting, setHosting] = useState<"headless" | "steam">("headless");
  const [selected, setSelected] = useState<string | null>(null);
  const [homeWorld, setHomeWorld] = useState("");
  const [realmOverride, setRealmOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginRealm = realmOverride ?? homeWorld;
  const headlessLogin = slot !== 0 && hosting === "headless";
  const availableRealms = realms.filter(realm => !realm.pvp);
  async function saveHomeWorld(realm: string) {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      await onHomeWorld(selected, realm);
      setHomeWorld(realm);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save home world");
    } finally { setBusy(false); }
  }
  const active = new Set(slots.map((entry) => entry.character).filter(Boolean));
  const choices = roster.filter(
    (member) => slot === 0 || (!active.has(member.name) && !member.online),
  );
  return (
    <Dialog
      open={slot !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {slot === 0 ? "Switch Steam character" : "Choose a roster member"}
          </DialogTitle>
          <DialogDescription className="text-emerald-100/55">
            {slot === 0
              ? "The Steam bridge changes the primary view and restores the other Steam characters afterward."
              : "Choose an offline character, or create a new character."}
          </DialogDescription>
        </DialogHeader>
        {slot !== 0 && <><div className="flex gap-2" aria-label="Login hosting">
          {(["headless", "steam"] as const).map(value => <button key={value} type="button" aria-pressed={hosting === value}
            disabled={busy} onClick={() => { setHosting(value); setSelected(null); }} className={`rounded border px-3 py-2 ${hosting === value ? "border-cyan-300 bg-[#164e63] text-white hover:bg-[#155e75]" : "border-slate-600 bg-[#111c19] text-slate-100 hover:bg-[#263c34]"}`}>{value === "steam" ? "Steam" : "Headless"}</button>)}
        </div>
        <p className="text-sm text-emerald-100/80">
          {hosting === "headless"
            ? "Runs on the computer hosting Party Console, without a game window."
            : "Runs in your connected Adventure Land Steam client."}
          {" Characters already online elsewhere are hidden; stop them there before loading them here."}
        </p></>}
        {!selected && <div className="grid max-h-80 gap-2 overflow-y-auto">
          {choices.map((member) => (
            <button
              key={member.name}
              onClick={() => {
                if (!headlessLogin) { void onChoose(member.name, hosting); return; }
                setSelected(member.name);
                setHomeWorld(member.homeWorld || (member.home ? "SR_" + member.home.replace(/^SR_/, "") : defaultRealm));
                setRealmOverride(null); setError(null);
              }}
              className="flex items-center justify-between rounded border border-emerald-900 bg-[#07100f] px-4 py-3 text-left text-emerald-50 hover:border-emerald-500 hover:bg-emerald-950 hover:text-white"
            >
              <span>
                <span className="block font-medium">{member.name}</span>
                <span className="font-mono text-xs uppercase text-emerald-100/45">
                  Lv {member.level} {member.ctype}
                </span>
              </span>
              <Plus className="h-4 w-4 text-emerald-400" />
            </button>
          ))}
          {!choices.length ? (
            <p className="py-8 text-center text-sm text-emerald-100/45">
              No available roster members.
            </p>
          ) : null}
        </div>}
        {selected && <div className="grid gap-4">
          <p className="font-medium text-emerald-50">{selected}</p>
          <label className="grid gap-2 text-sm text-emerald-100">
            Home world
            <select aria-label="Home world" value={homeWorld} disabled={busy}
              onChange={event => { void saveHomeWorld(event.target.value); }}
              className="rounded border border-emerald-700 bg-[#07100f] px-3 py-2 text-emerald-50 hover:border-cyan-400 disabled:opacity-50">
              {!availableRealms.some(realm => realm.key === homeWorld) && <option value={homeWorld} disabled>Choose a home world</option>}
              {availableRealms.map(realm => <option key={realm.key} value={realm.key}>{realm.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-emerald-100/70">Saved in Party Console as this character's default login world.</p>
          <label className="grid gap-2 text-sm text-emerald-100">
            Login realm
            <select aria-label="Login realm" value={realmOverride ?? "home"} disabled={busy}
              onChange={event => setRealmOverride(event.target.value === "home" ? null : event.target.value)}
              className="rounded border border-emerald-700 bg-[#07100f] px-3 py-2 text-emerald-50 hover:border-cyan-400 disabled:opacity-50">
              <option value="home">Home world ({availableRealms.find(realm => realm.key === homeWorld)?.label || homeWorld})</option>
              {availableRealms.map(realm => <option key={realm.key} value={realm.key}>{realm.label}</option>)}
            </select>
          </label>
          <p className="text-xs text-emerald-100/70">Changing the login realm applies to this login only.</p>
          {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => setSelected(null)}
              className="border border-slate-600 bg-[#111c19] text-slate-100 hover:bg-[#263c34]">Back</Button>
            <Button type="button" disabled={busy || !availableRealms.some(realm => realm.key === loginRealm)}
              className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300"
              onClick={async () => { setBusy(true); try { await onChoose(selected, hosting, loginRealm); } finally { setBusy(false); } }}>
              {busy ? "Please wait…" : "Log in character"}
            </Button>
          </div>
        </div>}
        <Button
          type="button"
          variant="outline"
          onClick={onCreate}
          className="border-cyan-700 bg-[#07100f] text-cyan-100 hover:bg-cyan-950 hover:text-white"
        >
          <Plus className="h-4 w-4" /> Create character
        </Button>
      </DialogContent>
    </Dialog>
  );
}
