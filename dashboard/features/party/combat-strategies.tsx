'use client';
import { useId, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { strategiesFor, strategyEnabled, type CombatStrategyId, type StrategySettings } from '../../../runtime/combat/strategies';

export function CombatStrategies({ ctype, settings, onToggle }: {
  ctype: string;
  settings?: StrategySettings;
  onToggle(id: CombatStrategyId, enabled: boolean): Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentId = useId();
  const strategies = strategiesFor(ctype);
  async function toggle(id: CombatStrategyId) {
    setBusy(true); setError(null);
    try { await onToggle(id, !strategyEnabled(settings, id)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update strategy'); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 border-t border-emerald-900/70 pt-3">
    <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)}
      className="flex h-9 w-full items-center gap-2 rounded border border-transparent bg-[#07110f] px-1 text-left font-mono text-xs uppercase text-emerald-100 hover:border-emerald-800 hover:bg-emerald-950">
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Strategies
    </button>
    {open && <div id={contentId} className="mt-3 flex flex-wrap gap-2">
      {strategies.map(strategy => {
        const enabled = strategyEnabled(settings, strategy.id);
        return <button key={strategy.id} type="button" aria-pressed={enabled} disabled={busy}
          title={strategy.description} onClick={() => void toggle(strategy.id)}
          className={`flex items-center gap-2 rounded border px-3 py-2 text-sm disabled:opacity-60 ${enabled
            ? 'border-cyan-500 bg-cyan-950 text-cyan-100 hover:border-cyan-300 hover:bg-cyan-900'
            : 'border-zinc-600 bg-[#111c19] text-zinc-200 hover:border-zinc-400 hover:bg-[#21342d]'}`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded border ${enabled ? 'border-cyan-300 bg-cyan-700 text-white' : 'border-zinc-500 bg-[#07110f]'}`}>
            {enabled && <Check aria-hidden="true" className="h-3 w-3" />}
          </span>
          {strategy.label}<span className="text-xs">{enabled ? 'On' : 'Off'}</span>
        </button>;
      })}
      {error && <p role="alert" className="w-full text-sm text-rose-200">{error}</p>}
    </div>}
  </section>;
}
