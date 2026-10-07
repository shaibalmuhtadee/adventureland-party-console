'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PartyWorkspace } from './party-workspace';
import type { PartyConsoleModel } from './use-party-console';
const MetricsView = lazy(() => import('./metrics-view'));
export type PartyView = 'characters' | 'metrics';
const arrow = 'flex items-center justify-center gap-2 rounded border border-cyan-700 bg-[#10201f] px-3 py-2 text-sm text-cyan-100 hover:border-cyan-300 hover:bg-cyan-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300';

export function PartyViewSwitch({ model, view, navigate }: { model: PartyConsoleModel; view: PartyView; navigate(view: PartyView): void }) {
  const characters = useRef<HTMLDivElement>(null), metrics = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null), forward = useRef<HTMLButtonElement>(null);
  const priorView = useRef(view);
  const [opened, setOpened] = useState(false), [height, setHeight] = useState<number>();
  useEffect(() => { if (view === 'metrics') setOpened(true); }, [view]);
  useEffect(() => {
    const element = view === 'characters' ? characters.current : metrics.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.getBoundingClientRect().height));
    observer.observe(element); return () => observer.disconnect();
  }, [view, opened]);
  useEffect(() => {
    if (priorView.current === view) return;
    priorView.current = view;
    (view === 'metrics' ? back : forward).current?.focus({ preventScroll: true });
  }, [view]);
  return <div className="relative md:px-12">
    <div className="mx-auto flex max-w-[1500px] justify-between gap-3 px-5 pt-4 md:pointer-events-none md:absolute md:inset-0 md:z-10 md:max-w-none md:items-start md:px-2 md:pt-0">
      {view === 'metrics' ? <button ref={back} className={arrow + ' md:pointer-events-auto md:sticky md:top-[50vh]'} onClick={() => navigate('characters')} aria-controls="party-character-view" aria-label="Back to characters" title="Back to characters"><ArrowLeft size={18} /><span className="md:sr-only">Back to characters</span></button> : <span />}
      {view === 'characters' && <button ref={forward} className={arrow + ' md:pointer-events-auto md:sticky md:top-[50vh]'} onClick={() => navigate('metrics')} aria-controls="party-metrics-view" aria-label="View metrics" title="View metrics"><span className="md:sr-only">View metrics</span><ArrowRight size={18} /></button>}
    </div>
    <div className="overflow-hidden transition-[height] duration-250 motion-reduce:transition-none" style={{ height }}>
      <div className="grid items-start transition-transform duration-250 ease-in-out motion-reduce:transition-none" style={{ gridTemplateColumns: '100% 100%', transform: view === 'metrics' ? 'translateX(-100%)' : 'translateX(0)' }}>
        <div id="party-character-view" ref={characters} inert={view !== 'characters'} aria-hidden={view !== 'characters'} className="min-w-0"><PartyWorkspace model={model} /></div>
        <div id="party-metrics-view" ref={metrics} inert={view !== 'metrics'} aria-hidden={view !== 'metrics'} className="min-w-0">
          {opened && <Suspense fallback={<p className="px-10 py-20 text-slate-200">Loading metrics…</p>}><MetricsView active={view === 'metrics'} /></Suspense>}
        </div>
      </div>
    </div>
  </div>;
}
