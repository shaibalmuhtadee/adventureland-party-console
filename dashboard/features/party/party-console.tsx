"use client";
import { useEffect, useRef, useState } from "react";
import { LogSidebar } from "./log-sidebar";
import { PartyHeader } from "./party-header";
import { PartyInventoryPanels } from "./party-inventory-panels";
import { PartyManagementPanels } from "./party-management-panels";
import { PartyReferencePanels } from "./party-reference-panels";
import { PartyWorkspacePanels } from "./party-workspace";
import { PartyViewSwitch, type PartyView } from './party-view-switch';
import { usePartyConsole } from "./use-party-console";
import { DashboardLive } from "./dashboard-live";
import { DashboardQueries } from "./query-cache";
import { DebugBrowserBanner } from './debug-browser';

export function Home() {
  return <DashboardQueries><DashboardLive /><PartyConsole /></DashboardQueries>;
}
function PartyConsole() {
  const model = usePartyConsole();
  const [logsOpen,setLogsOpen]=useState(false),[logsWidth,setLogsWidth]=useState(440);
  const [view, setView] = useState<PartyView>('characters');
  const positions = useRef({ characters: 0, metrics: 0 });
  const navigate = (next: PartyView) => {
    if (next === view) return;
    positions.current[view] = window.scrollY;
    setView(next);
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => window.scrollTo({ top: positions.current[view], behavior: 'instant' }));
    const timer = setTimeout(() => window.scrollTo({ top: positions.current[view], behavior: 'instant' }), 275);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [view]);
  return (
    <>
      <main style={{marginRight:logsOpen?`min(${logsWidth}px,75vw)`:0}} data-party-console-root className="@container min-h-screen bg-[#07100f] text-[#e9f3e8]">
        <PartyHeader model={model} onLogs={() => setLogsOpen(v=>!v)} metricsActive={view === 'metrics'} onMetrics={() => navigate('metrics')} />
        <DebugBrowserBanner />
        <PartyViewSwitch model={model} view={view} navigate={navigate} />
      </main>
      {logsOpen && <LogSidebar state={model.state} width={logsWidth} onWidth={setLogsWidth} onClose={() => setLogsOpen(false)} />}
      <PartyInventoryPanels model={model} />
      <PartyReferencePanels model={model} />
      <PartyManagementPanels model={model} />
      <PartyWorkspacePanels model={model} />
    </>
  );
}
