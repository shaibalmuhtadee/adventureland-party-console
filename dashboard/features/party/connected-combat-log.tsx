"use client";
import { memo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { domainOptions, useVisible } from "./query-cache";
import { CombatLog } from "./combat-log";
import type { CombatLogEntry } from "./combat-log-entry";
const empty: CombatLogEntry[] = [];
function LogContents({ character }: { character: string }) {
  const client = useQueryClient(),
    visible = useVisible();
  const query = useQuery({
    ...domainOptions(client, "logs"),
    enabled: visible,
    select: (data) => data.combatLogs?.[character] || empty,
  });
  return <CombatLog character={character} entries={query.data || empty} />;
}
export const ConnectedCombatLog = memo(function ConnectedCombatLog({
  character,
}: {
  character: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-5 border-t border-emerald-900/70 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${open ? "mb-2" : ""} flex w-full items-center justify-between text-left`}
      >
        <h3 className="flex items-center gap-2 font-mono text-xs uppercase text-emerald-100/55">
          {open ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Combat log
        </h3>
      </button>
      {open && <LogContents character={character} />}
    </section>
  );
});
