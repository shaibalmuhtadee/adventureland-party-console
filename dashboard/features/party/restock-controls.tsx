"use client";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { RestockPolicy } from "./restock-policy";

const defaults: RestockPolicy = {
  hp: { min: 5, max: 20, item: "hpot1" },
  mp: { min: 0, max: 0, item: "mpot1" },
};

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 500;
const SAVED_FADE_MS = 2000;

export const RestockControls = memo(function RestockControls({
  character,
  value,
  onSave,
}: {
  character: string;
  value?: RestockPolicy;
  onSave: (character: string, value: RestockPolicy) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RestockPolicy>(value || defaults),
    dirty = useRef(false);
  const [open, setOpen] = useState(true);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  const saving = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFade = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Character status polling returns a new policy object on every refresh.
  // Reconcile it only while the user has no unsaved local edits.
  useEffect(() => {
    if (!dirty.current) {
      draftRef.current = value || defaults;
      setDraft(draftRef.current);
    }
  }, [value]);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedFade.current) clearTimeout(savedFade.current);
    },
    [],
  );
  async function runSave() {
    if (saving.current || !dirty.current) return;
    saving.current = true;
    try {
      for (;;) {
        setStatus("saving");
        setSaveError(null);
        const snapshot = draftRef.current;
        try {
          await onSaveRef.current(character, snapshot);
        } catch (error) {
          dirty.current = true;
          setSaveError(error instanceof Error ? error.message : String(error));
          setStatus("error");
          return;
        }
        // Only claim success if nothing changed mid-save; otherwise loop
        // and persist the newer draft instead of dropping it.
        if (draftRef.current !== snapshot) continue;
        dirty.current = false;
        setStatus("saved");
        if (savedFade.current) clearTimeout(savedFade.current);
        savedFade.current = setTimeout(() => {
          setStatus((current) => (current === "saved" ? "idle" : current));
        }, SAVED_FADE_MS);
        return;
      }
    } finally {
      saving.current = false;
    }
  }
  function scheduleSave() {
    dirty.current = true;
    setStatus((current) => (current === "saving" ? current : "dirty"));
    setSaveError(null);
    if (savedFade.current) clearTimeout(savedFade.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void runSave();
    }, SAVE_DEBOUNCE_MS);
  }
  function retrySave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void runSave();
  }
  const field = (kind: "hp" | "mp", key: "min" | "max", label: string) => (
    <label className="grid gap-1 font-mono text-[10px] uppercase text-emerald-100/45">
      {label}
      <Input
        inputMode="numeric"
        value={draft[kind][key]}
        onChange={(event) => {
          dirty.current = true;
          const next = {
            ...draft,
            [kind]: {
              ...draft[kind],
              [key]: Number(event.target.value.replace(/[^0-9]/g, "")),
            },
          };
          draftRef.current = next;
          setDraft(next);
          scheduleSave();
        }}
        className="h-8 border-emerald-900 bg-black/25 text-xs"
      />
    </label>
  );
  const statusClass = "w-32 truncate whitespace-nowrap text-right font-mono text-xs";
  const statusIndicator =
    status === "error" ? (
      <button
        type="button"
        onClick={retrySave}
        title={saveError || "Save failed. Click to retry."}
        aria-live="polite"
        className={`${statusClass} text-rose-300 hover:text-rose-100`}
      >
        Save failed — retry
      </button>
    ) : status === "saving" ? (
      <span aria-live="polite" className={`${statusClass} text-emerald-100/40`}>
        Saving…
      </span>
    ) : status === "saved" ? (
      <span aria-live="polite" className={`${statusClass} text-emerald-300`}>
        Saved ✓
      </span>
    ) : status === "dirty" ? (
      <span aria-live="polite" className={`${statusClass} text-amber-300`}>
        Unsaved changes
      </span>
    ) : (
      <span aria-hidden="true" className={statusClass} />
    );
  return (
    <div>
      <div className="mb-3 mt-5 flex items-center justify-between border-t border-emerald-900 pt-5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-2 text-left"
        >
          <span className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/55">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Merchant restock
          </span>
        </button>
        {statusIndicator}
      </div>
      {open ? (
        <div className="grid grid-cols-4 gap-2">
          {field("hp", "min", "HP min")}
          {field("hp", "max", "HP max")}
          {field("mp", "min", "MP min")}
          {field("mp", "max", "MP max")}
        </div>
      ) : null}
    </div>
  );
});
