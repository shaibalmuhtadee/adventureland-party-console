'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MetricsResponse } from '../../../runtime/metrics/contracts.ts';
import { encouragementLuck, projectDirectDrop } from '../../../runtime/metrics/luck.ts';
import type { MerchantCatalog } from './merchant-catalog';
import type { Char } from './char';
import { characterKey } from './character-cache';
import { MetricsChart, metricFormat } from './metrics-chart';
import { MetricsSelect, metricsControl } from './metrics-controls';
import { MetricsItemPicker } from './metrics-item-picker';
import { observedMonsterRate, selectMetricRows, type GraphPoint } from './metrics-series';
import { effectiveDropRate } from './drop-rate';

export function MetricsDropEstimator({ data, catalog, characters, server, live }: {
  data: MetricsResponse; catalog?: MerchantCatalog; characters: string[]; server: string; live: boolean;
}) {
  const [itemId, setItemId] = useState(''), [sourceIndex, setSourceIndex] = useState(0);
  const [rateOverride, setRateOverride] = useState(''), [luckOverride, setLuckOverride] = useState(''), [luckCharacter, setLuckCharacter] = useState('');
  const [share, setShare] = useState('1'), [level, setLevel] = useState('1'), [multiplier, setMultiplier] = useState('1'), [rolls, setRolls] = useState('1');
  const [contributionOverride, setContributionOverride] = useState(''), [encouragementOverride, setEncouragementOverride] = useState('');
  const [hours, setHours] = useState(false), [target, setTarget] = useState('95');
  function reset() {
    setItemId(''); setSourceIndex(0); setRateOverride(''); setLuckOverride(''); setLuckCharacter('');
    setShare('1'); setLevel('1'); setMultiplier('1'); setRolls('1'); setContributionOverride('');
    setEncouragementOverride(''); setHours(false); setTarget('95');
  }
  const items = useMemo(() => (catalog?.allItems || []).filter(item => item.meta?.world?.drops?.length), [catalog]);
  const selected = items.find(item => item.id === itemId), sources = selected?.meta?.world?.drops || [], source = sources[sourceIndex];
  const direct = !!source && source.sourceType === 'monster' && (source.acquisitionPath?.length || 0) <= 1;
  const baseRate = source ? source.baseRate ?? effectiveDropRate(source) : 0, supported = direct && baseRate > 0 && baseRate <= 1;
  const rows = selectMetricRows(data.points.flatMap(point => point.values), characters, server);
  const participants = new Map<string, number>();
  for (const row of rows) {
    const credits = row.credits.filter(credit => credit.monster === source?.monsterId).reduce((sum, credit) => sum + credit.count, 0);
    if (credits) participants.set(row.character, (participants.get(row.character) || 0) + credits);
  }
  const automaticName = [...participants].sort((a, b) => b[1] - a[1])[0]?.[0] || rows[0]?.character;
  const selectedName = luckCharacter || automaticName || '';
  const latest = rows.filter(row => row.character === selectedName).sort((a, b) => b.last.at - a.last.at)[0];
  const currentBuffs = useQuery({
    queryKey: characterKey(selectedName, 'vitals'), enabled: false, staleTime: Infinity,
    queryFn: (): Partial<Char> => ({}),
    select: (character: Partial<Char>) => !live || !character.conditions ? undefined
      : encouragementLuck(undefined, Object.fromEntries(character.conditions.map(condition => [condition.id, condition.live]))) ?? undefined,
  }).data;
  const fresh = latest && Date.now() - latest.last.at < 30_000;
  const nativeEncouragement = fresh && currentBuffs !== undefined ? currentBuffs : latest?.last.encouragementLuck ?? 1;
  const encouragement = encouragementOverride === '' ? nativeEncouragement : Number(encouragementOverride);
  const allRows = selectMetricRows(data.points.flatMap(point => point.values), [], server);
  const monsterDamage = allRows.flatMap(row => row.damage.filter(hit => hit.monster === source?.monsterId).map(hit => ({ character: row.character, amount: hit.amount })));
  const totalDamage = monsterDamage.reduce((sum, hit) => sum + hit.amount, 0), ownDamage = monsterDamage.filter(hit => hit.character === selectedName).reduce((sum, hit) => sum + hit.amount, 0);
  const observedContribution = totalDamage > 0 ? Math.min(1, ownDamage / totalDamage) : 1;
  const contribution = contributionOverride === '' ? observedContribution : Number(contributionOverride) / 100;
  const luck = luckOverride === '' ? latest?.last.luck ?? null : Number(luckOverride);
  const observed = source ? observedMonsterRate(data, source.monsterId, server, characters) : null;
  const rate = rateOverride === '' ? observed : Number(rateOverride);
  const rollCount = Number(rolls), shareValue = Number(share), levelValue = Number(level), modifierValue = Number(multiplier);
  const valid = luck !== null && Number.isFinite(luck) && luck > 0 && shareValue > 0 && shareValue <= 1 &&
    Number.isFinite(levelValue) && levelValue >= 1 && Number.isFinite(modifierValue) && modifierValue > 0 &&
    Number.isInteger(rollCount) && rollCount >= 1 && rollCount <= 100 && Number.isFinite(encouragement) && encouragement >= 1 &&
    Number.isFinite(contribution) && contribution >= 0 && contribution <= 1;
  const projection = supported && valid ? projectDirectDrop({ baseRate, luck, share: shareValue, contribution, encouragement, level: levelValue, modifier: modifierValue, rolls: rollCount }) : null;
  const probability = projection?.probability ?? null;
  const threshold = (q: number) => probability === null || probability <= 0 ? null : probability === 1 ? 1 : Math.ceil(Math.log1p(-q) / Math.log1p(-probability));
  const average = probability && probability > 0 ? 1 / probability : null;
  const targetValue = Number(target), targetKills = targetValue > 0 && targetValue < 100 ? threshold(targetValue / 100) : null;
  const horizon = Math.max(1, threshold(.99) || 1), rateValid = rate !== null && Number.isFinite(rate) && rate > 0;
  const curve = useMemo<GraphPoint[]>(() => probability === null || (hours && !rateValid) ? [] : Array.from({ length: 201 }, (_, index) => {
    const kills = horizon * index / 200;
    return { at: hours && rateValid ? kills / rate : kills, probability: probability === 1 ? kills >= 1 ? 100 : 0 : -Math.expm1(kills * Math.log1p(-probability)) * 100 };
  }), [probability, hours, rateValid, rate, horizon]);
  function chooseItem(id: string) {
    setItemId(id);
    const next = items.find(item => item.id === id)?.meta?.world?.drops || [];
    const index = next.findIndex(source => source.sourceType === 'monster' && (source.acquisitionPath?.length || 0) <= 1);
    setSourceIndex(Math.max(0, index));
  }
  const input = (label: string, value: string, change: (value: string) => void, placeholder: string, min = 0, max?: number, title?: string) =>
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[#91aa9d]" title={title}>{label}<input className={metricsControl + ' w-full justify-start tabular-nums'} type="number" min={min} max={max} step="any" value={value} placeholder={placeholder} onChange={event => change(event.target.value)} /></label>;
  const milestones = [{ label: 'Mean', kills: average }, { label: '50%', kills: threshold(.5) }, { label: '90%', kills: threshold(.9) }, { label: target + '%', kills: targetKills }];
  return <MetricsChart title="Item drop estimate" data={curve} series={[{ key: 'probability', label: 'At least one drop', color: '#4ade80' }]} onReset={reset} resetTitle="Reset estimate and options" logarithmic logarithmicX
    yLabel="Chance (%)" yDomain={[0, 100]} xFormat={value => metricFormat(value) + (hours ? ' h' : ' kills')}
    references={[50, 90, 95].map(value => ({ value, label: value + '%' }))}
    empty={!selected ? 'Choose an item' : !supported ? 'Unsupported drop source' : !valid ? 'Set luck in options' : hours && !rateValid ? 'Set kills per hour' : 'No drop chance'}
    controls={<>
      <MetricsItemPicker items={items} value={itemId} onChange={chooseItem} />
      <MetricsSelect label="Drop source" className="w-28" value={String(sourceIndex)} onChange={value => setSourceIndex(Number(value))}
        options={sources.length ? sources.map((source, index) => ({ value: String(index), label: source.monsterName })) : [{ value: '0', label: 'Source' }]} />
      <MetricsSelect label="X-axis unit" className="w-20" value={hours ? 'hours' : 'kills'} onChange={value => setHours(value === 'hours')} options={[{ value: 'kills', label: 'Kills' }, { value: 'hours', label: 'Hours', disabled: !rateValid }]} />
    </>}
    optionDetails={<>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 border-t border-[#30433f] pt-3">
          <label className="col-span-2 grid gap-1.5 text-sm font-medium text-[#91aa9d]">Luck character
            <MetricsSelect label="Luck character" className="w-full max-w-none justify-start" value={luckCharacter} onChange={setLuckCharacter} options={[{ value: '', label: 'Automatic' }, ...data.characters.map(name => ({ value: name, label: name }))]} />
          </label>
          {input('Kills / hour', rateOverride, setRateOverride, observed ? metricFormat(observed) : 'Auto')}
          {input('Luck (×)', luckOverride, setLuckOverride, latest ? latest.last.luck.toFixed(2) : 'Auto')}
          {input('Encouragement (×)', encouragementOverride, setEncouragementOverride, nativeEncouragement.toFixed(2), 1)}
          {input('Contribution (%)', contributionOverride, setContributionOverride, (observedContribution * 100).toFixed(1), 0, 100, 'Auto uses tracked damage. Override for untracked players or healing contribution.')}
          {input('Loot share', share, setShare, '1', .001, 1)}
          {input('Monster level', level, setLevel, '1', 1)}
          {input('Monster modifier', multiplier, setMultiplier, '1', .001)}
          {input('Ordinary rolls', rolls, setRolls, '1', 1, 100)}
          {input('Target chance (%)', target, setTarget, '95', 1, 99.99)}
          <div className="grid content-center gap-1.5 text-sm text-[#91aa9d]"><span>Expected / 1,000 kills</span><span className="text-base font-semibold tabular-nums text-slate-100">{projection ? metricFormat(1000 * projection.expectedRewards * (source?.quantity || 1)) : '—'}</span></div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-[#30433f] pt-3 text-sm text-[#91aa9d]"><span className="truncate">{selectedName || 'No character'}</span><span className="shrink-0 text-emerald-300">{metricFormat(encouragement)}× Encouragement</span></div>
    <div className="grid w-full grid-cols-2 gap-3 border-t border-[#30433f] pt-3">{milestones.map((value, index) => <div key={index} className="min-w-0">
      <span className="block text-sm font-medium text-[#789087]">{value.label}</span>
      <span className="mt-0.5 block truncate text-base font-semibold tabular-nums text-[#d6e9de]">{value.kills === null ? '—' : metricFormat(hours && rateValid ? value.kills / rate : value.kills)}<span className="ml-1 text-sm font-normal text-[#789087]">{hours ? 'h' : 'kills'}</span></span>
    </div>)}</div></>} />;
}
