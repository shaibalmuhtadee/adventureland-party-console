'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ActivityPlanConfig } from '../../../runtime/activity-plan';
import type { PartyConsoleModel } from './use-party-console';

const control = 'rounded border border-slate-600 bg-[#10201f] px-3 py-2 text-sm text-slate-100 hover:border-cyan-300 hover:bg-cyan-950 disabled:opacity-50';
const phases = {solo:'Solo farming',preparing:'Preparing for event',participating:'Participating',looting:'Finishing loot',town:'Returning to town',collecting:'Collecting fighter loot',returning:'Returning to solo farming'};
const bossNames = {mrpumpkin:'Mr. Pumpkin',mrgreen:'Mr. Green'};

export function ActivityPlanCard({model}:{model:PartyConsoleModel}) {
  const {state,post} = model, plan = state.activityPlan, run = plan?.run;
  const roster = state.roster || [];
  const defaults = useMemo<ActivityPlanConfig>(() => {
    const farmer = roster.find(m=>m.ctype==='rogue')?.name || roster.find(m=>m.ctype!=='merchant')?.name || '';
    return {farmer,companions:['warrior','priest'].flatMap(ctype=>{
      const name = roster.find(m=>m.ctype===ctype && m.name!==farmer)?.name; return name ? [name] : [];
    }),merchant:state.merchantCharacter || roster.find(m=>m.ctype==='merchant')?.name || '',realm:'SR_USIV',
    bosses:['mrpumpkin','mrgreen'],preparationSeconds:120};
  },[roster,state.merchantCharacter]);
  const [config,setConfig]=useState(plan?.config || defaults), [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!dirty)setConfig(plan?.config || defaults);},[plan?.config,defaults,dirty]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
  function edit(patch:Partial<ActivityPlanConfig>) {setDirty(true);setConfig(c=>({...c,...patch}));}
  async function action(action:string) {
    setBusy(true);setError(null);
    try {await post('/activity-plan',{action,config});setDirty(false);}
    catch(error){setError(error instanceof Error ? error.message : String(error));}
    finally{setBusy(false);}
  }
  const next=plan?.status?.next || run?.encounter;
  const countdown=next ? Math.max(0,Math.ceil((next.spawnAt-now)/1000)) : null;
  return <article className="mb-5 rounded border border-emerald-800 bg-[#071315] p-4 text-slate-100">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-emerald-100">Solo Farming + Events</h2>
        <p className="text-sm text-slate-300">{run ? `${phases[run.phase]} · ${run.mode}` : 'Stopped. Uses each fighter’s saved farming and combat settings.'}</p></div>
      <div className="flex gap-2">
        {!run ? <><button className={control} disabled={busy || !config.farmer} onClick={()=>void action('configure')}>Save</button><button className={control} disabled={busy || !config.farmer} onClick={()=>void action('start')}>Start</button></> :
          <><button className={control} disabled={busy} onClick={()=>void action(run.mode==='paused'?'resume':'pause')}>{run.mode==='paused'?'Resume':'Pause'}</button><button className={control} disabled={busy || run.mode==='stopping'} onClick={()=>void action('stop')}>{run.mode==='stopping'?'Stopping after cleanup…':'Stop after cleanup'}</button></>}
      </div>
    </div>
    <fieldset disabled={busy || !!run} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="grid gap-1 text-sm">Solo farmer<select className={control} value={config.farmer} onChange={e=>edit({farmer:e.target.value,companions:config.companions.filter(n=>n!==e.target.value)})}><option value="">Choose farmer</option>{roster.filter(m=>m.ctype!=='merchant').map(m=><option key={m.name} value={m.name}>{m.name} · {m.ctype}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Merchant<select className={control} value={config.merchant} onChange={e=>edit({merchant:e.target.value})}><option value="">Choose merchant</option>{roster.filter(m=>m.ctype==='merchant').map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Operating realm<select className={control} value={config.realm} onChange={e=>edit({realm:e.target.value})}>{(state.realmControl?.realms || []).filter(r=>!r.pvp).map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
      <label className="grid gap-1 text-sm">Prepare before spawn (seconds)<input className={control} type="number" min={30} max={600} value={config.preparationSeconds} onChange={e=>edit({preparationSeconds:Number(e.target.value)})}/></label>
      <div className="text-sm sm:col-span-2"><p className="mb-1">Event companions (up to two)</p><div className="flex flex-wrap gap-3">{roster.filter(m=>m.ctype!=='merchant' && m.name!==config.farmer).map(m=><label key={m.name} className="flex items-center gap-1"><input type="checkbox" checked={config.companions.includes(m.name)} disabled={!config.companions.includes(m.name) && config.companions.length>=2} onChange={e=>edit({companions:e.target.checked ? [...config.companions,m.name] : config.companions.filter(n=>n!==m.name)})}/>{m.name} · {m.ctype}</label>)}</div></div>
      <div className="text-sm sm:col-span-2"><p className="mb-1">Bosses</p><div className="flex gap-3">{(['mrpumpkin','mrgreen'] as const).map(boss=><label key={boss} className="flex items-center gap-1"><input type="checkbox" checked={config.bosses.includes(boss)} onChange={e=>edit({bosses:e.target.checked ? [...config.bosses,boss] : config.bosses.filter(b=>b!==boss)})}/>{bossNames[boss]}</label>)}</div></div>
    </fieldset>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-300">
      <p>{next ? `${bossNames[next.type]} · ${countdown === 0 ? 'Spawn due' : `${Math.floor(countdown!/60)}m ${countdown!%60}s until spawn`}` : 'Waiting for an announced selected spawn'}</p>
      {run && <><p>Desired: {plan.status?.desired.join(', ') || 'Reconciling'}</p><p>Observed: {plan.status?.observed.join(', ') || 'None'}</p></>}
    </div>
    <div className="mt-2 flex flex-wrap gap-2 text-sm">{config.companions.map(name=><span key={name} className="rounded border border-slate-700 bg-[#10201f] px-2 py-1">{name} · {run && plan.status?.desired.includes(name) ? (plan.status.observed.includes(name)?'Online for event':'Connecting for event') : 'Offline until event'}</span>)}</div>
    {(error || run?.waiting) && <p role="status" className="mt-2 text-sm text-amber-200">{error || run?.waiting}</p>}
    <p className="mt-2 text-xs text-slate-400">Pause holds new transitions while an issued operation settles. Stop finishes loot and collection, logs companions out, and returns the farmer before releasing ownership.</p>
  </article>;
}
