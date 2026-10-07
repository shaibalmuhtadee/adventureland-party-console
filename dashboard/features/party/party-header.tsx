"use client";
import { Button } from "@/components/ui/button";
import {
  BookOpen,
  ChartNoAxesCombined,
  Landmark,
  Mail,
  PackageOpen,
  Settings,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { PartyGold } from "./party-gold";
import type { PartyConsoleModel } from "./use-party-console";
import { MailCount } from "./mail-count";
import { StandCount } from "./stand-count";
import { ConsoleUpdateIndicator, useUpdates } from './console-updates';

function ListCode({className}:{className:string}) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 4h18M3 8h18M3 12h7M7 16l-4 3 4 3m10-6 4 3-4 3m-3-7-3 8" /></svg>; }

export function PartyHeader({ model, onLogs, metricsActive, onMetrics }: { model: PartyConsoleModel; onLogs: () => void; metricsActive: boolean; onMetrics: () => void }) {
  const { state: updates } = useUpdates();
  const {
    state,
    setMailOpen,
    setCatalogOpen,
    setBestiaryOpen,
    setSkillsOpen,
    setStandOpen,
    setMarketOpen,
    setBankOpen,
    setSettingsOpen,
    setRealmDestination,
    aldataKey,
    aldataAction,
  } = model;
  return (
    <>
      <header className="border-b border-emerald-900/70 bg-[#091614] px-5 py-5 md:px-10">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-5">
          <div className="relative"><div className="flex items-center"><h1 className="text-3xl font-semibold">Party Console</h1><ConsoleUpdateIndicator open={() => setSettingsOpen(true)} /></div>
            <span className="mt-1 block font-mono text-[10px] leading-3 text-emerald-100/70">{state.gameVersion ? `Game v${state.gameVersion} · ` : ''}Console {updates ? `v${updates.displayVersion || updates.current}` : 'loading…'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={onMetrics} aria-pressed={metricsActive} aria-controls="party-metrics-view"
              className={metricsActive ? 'border-cyan-300 bg-cyan-950 text-cyan-100 hover:bg-cyan-900 hover:text-white' : 'border-cyan-700 bg-[#10201f] text-cyan-200 hover:bg-cyan-950 hover:text-white'}>
              <ChartNoAxesCombined className="mr-2 h-4 w-4" />Metrics
            </Button>
            <Button
              variant="outline"
              onClick={() => setMailOpen(true)}
              className="border-sky-600 bg-black text-sky-200 hover:bg-sky-950 hover:text-white"
            >
              <Mail className="mr-2 h-4 w-4" />
              Mail<MailCount />
            </Button>
            <Button
              variant="outline"
              onClick={() => setCatalogOpen(true)}
              className="border-cyan-700 bg-transparent text-cyan-300"
            >
              <PackageOpen className="mr-2 h-4 w-4" />
              Catalog
            </Button>
            <Button
              variant="outline"
              onClick={() => setBestiaryOpen(true)}
              className="border-rose-700 bg-transparent text-rose-300"
            >
              <BookOpen className="mr-2 h-4 w-4" />
              Bestiary
            </Button>
            <Button
              variant="outline"
              onClick={() => setSkillsOpen(true)}
              className="border-violet-700 bg-transparent text-violet-300"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Skills
            </Button>
            <Button
              variant="outline"
              onClick={() => setStandOpen(true)}
              className="border-amber-700 bg-transparent text-amber-300"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              Inspect stand · <StandCount name={state.merchantCharacter || ""} listings={state.standListings} nativeStand={state.nativeStand} bids={state.standBids} />/16
            </Button>
            <Button
              variant="outline"
              onClick={() => setMarketOpen(true)}
              className="border-cyan-700 bg-transparent text-cyan-300"
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              View market
            </Button>
            <Button
              variant="outline"
              onClick={() => setBankOpen(true)}
              className="border-emerald-700 bg-transparent text-emerald-300"
            >
              <Landmark className="mr-2 h-4 w-4" />
              Inspect bank
            </Button>
            <Button onClick={onLogs} aria-label="Show logs" className="border border-slate-600 bg-slate-950 text-slate-100 hover:bg-slate-800"><ListCode className="mr-2 size-4" />Logs</Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                setSettingsOpen(true);
                setRealmDestination(
                  state.realmControl?.activeRealm || state.realmControl?.currentRealm || "",
                );
                if (state.aldata?.hasKey && !aldataKey) void aldataAction("reveal");
              }}
              className="border-slate-700 bg-transparent text-slate-300"
              aria-label="Interface settings"
              title="Interface settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <PartyGold state={state} />
          </div>
        </div>
      </header>
    </>
  );
}
