'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Expand, ListFilter, RotateCcw, LoaderCircle, X } from 'lucide-react';
import type { GraphPoint, GraphSeries } from './metrics-series';
import { MetricsMenu, MetricsSelect, metricsIconControl } from './metrics-controls';

export const metricFormat = (value: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: Math.abs(value) >= 10000 ? 'compact' : 'standard' }).format(value);
interface Props {
  title: string;
  data: GraphPoint[];
  series: GraphSeries[];
  yLabel: string;
  xLabel?: string;
  xFormat?: (value: number) => string;
  type?: 'line' | 'bar';
  categoryAxis?: boolean;
  logarithmic?: boolean;
  logarithmicX?: boolean;
  currentValue?: { amount: number | null; unit: string; label?: string; exact?: boolean };
  barCategories?: { label: string; total: number; rate: string }[];
  onReset(): void;
  resetDisabled?: boolean;
  resetting?: boolean;
  resetTitle?: string;
  controls?: ReactNode;
  footer?: ReactNode;
  empty?: string;
  references?: { value: number; label: string }[];
  yDomain?: [number, number];
}
const timeLabel = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export function MetricsChart(props: Props) {
  const id = useId(), [expanded, setExpanded] = useState(false), [scale, setScale] = useState<'linear' | 'logY' | 'logX'>('linear'), [hidden, setHidden] = useState<string[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => { document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus({ preventScroll: true }); };
  }, [expanded]);
  const active = props.series.filter(line => !hidden.includes(line.key));
  const numbers = props.resetting ? [] : props.data.flatMap(point => active.map(line => point[line.key])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const positive = numbers.filter(value => value > 0);
  const hasNegative = numbers.some(value => value < 0), useLog = !!props.logarithmic && scale === 'logY' && !hasNegative && positive.length > 0;
  const xValues = props.data.map(point => point.at).filter(value => value > 0);
  const useLogX = !!props.logarithmicX && scale === 'logX' && xValues.length > 0;
  const xLow = xValues.reduce((minimum, value) => Math.min(minimum, value), Infinity), xHigh = xValues.reduce((maximum, value) => Math.max(maximum, value), 0);
  const xDomain = useLogX ? [10 ** Math.floor(Math.log10(xLow)), 10 ** Math.max(Math.floor(Math.log10(xLow)) + 1, Math.ceil(Math.log10(xHigh)))] : undefined;
  const low = positive.length ? Math.floor(Math.log10(positive.reduce((minimum, value) => Math.min(minimum, value), Infinity))) : 0;
  const high = positive.length ? Math.max(low + 1, Math.ceil(Math.log10(positive.reduce((maximum, value) => Math.max(maximum, value), 0)))) : 1;
  const ticks = useLog ? Array.from({ length: Math.min(16, high - low + 1) }, (_, i) => 10 ** (low + i)) : undefined;
  const visibleData = useLogX ? props.data.filter(point => point.at > 0) : props.data;
  const plotted = useLog ? visibleData.map(point => ({ ...point, ...Object.fromEntries(active.map(line => [line.key, (point[line.key] ?? 0) > 0 ? point[line.key] : null])) })) : visibleData;
  const timeTick = (at: number) => props.data.length > 1 && props.data[props.data.length - 1].at - props.data[0].at >= 86_400_000
    ? new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : timeLabel(at);
  const axisColor = '#789087', labelColor = '#aabfb6';
  const content = <section aria-labelledby={id} className={'flex min-h-0 min-w-0 flex-col rounded-2xl border border-[#263d33] bg-[#0b1914] p-5 text-slate-100 shadow-[0_8px_28px_rgba(0,0,0,0.12)] ' + (expanded ? 'fixed inset-6 z-[100] p-8' : 'h-[460px]')}>
    <div className="mb-3 flex min-h-9 shrink-0 items-center justify-between gap-3">
      <h3 id={id} className="text-xl font-semibold tracking-tight text-[#e8f3ed]">{props.title}</h3>
      {props.currentValue && <div className="flex shrink-0 items-baseline gap-2 text-right tabular-nums" aria-label={props.currentValue.label || 'Current ' + props.title}>
        <span className="text-2xl font-semibold text-cyan-200">{props.resetting || props.currentValue.amount === null ? '—' : props.currentValue.exact ? props.currentValue.amount.toLocaleString() : metricFormat(props.currentValue.amount)}</span><span className="text-base text-[#aabfb6]">{props.currentValue.unit}</span>
      </div>}
    </div>
    <div className="mb-3 flex min-h-12 shrink-0 items-center gap-2">
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
      {props.controls}
      {(props.logarithmic || props.logarithmicX) && <MetricsSelect label="Graph scale" value={useLog ? 'logY' : useLogX ? 'logX' : 'linear'} onChange={value => setScale(value === 'logX' ? 'logX' : value === 'logY' ? 'logY' : 'linear')}
        className="w-24" options={[{ value: 'linear', label: 'Linear' }, ...(props.logarithmicX ? [{ value: 'logX', label: 'Log X', disabled: !xValues.length }] : []), ...(props.logarithmic ? [{ value: 'logY', label: props.logarithmicX ? 'Log Y' : 'Log', disabled: hasNegative || !positive.length }] : [])]} />}
      {props.series.length > 1 && <MetricsMenu label="Graph series" trigger={<ListFilter size={18} />}>
        <div className="max-h-64 overflow-auto">{props.series.map(line => <label key={line.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-base hover:bg-[#1a3228]">
          <input type="checkbox" className="accent-emerald-400" checked={!hidden.includes(line.key)} onChange={() => setHidden(hidden.includes(line.key) ? hidden.filter(key => key !== line.key) : [...hidden, line.key])} />
          <span className="size-2 shrink-0 rounded-full" style={{ background: line.color }} /><span className="truncate">{line.label}</span>
        </label>)}</div>
      </MetricsMenu>}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <button className={metricsIconControl} aria-label={props.resetTitle || 'Permanently reset ' + props.title + ' history'} title={props.resetTitle || 'Reset stored data'} disabled={props.resetDisabled || props.resetting} onClick={props.onReset}>{props.resetting ? <LoaderCircle size={18} className="animate-spin" /> : <RotateCcw size={18} />}</button>
      <button className={metricsIconControl} aria-label={(expanded ? 'Close expanded ' : 'Expand ') + props.title} title={expanded ? 'Close' : 'Expand'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18} /> : <Expand size={18} />}</button>
    </div>
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
    <div className="h-full" style={props.barCategories ? { minWidth: Math.max(300, props.barCategories.length * 132 + 100) } : undefined}>
      {!numbers.length ? <div className="grid h-full place-items-center text-base text-[#789087]">{props.resetting ? 'Resetting…' : props.empty || (active.length ? 'No data' : 'Select a series')}</div> : <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={plotted} layout={props.categoryAxis ? 'vertical' : 'horizontal'} margin={{ top: props.barCategories ? 34 : 10, right: 14, bottom: props.barCategories ? 6 : 34, left: 12 }} accessibilityLayer>
          <CartesianGrid stroke="#23392e" strokeDasharray="3 5" />
          {props.barCategories ? <>
            <XAxis dataKey="at" type="category" interval={0} height={78} stroke={axisColor} axisLine={false} tickLine={false}
              label={{ value: props.xLabel || 'Monster', position: 'insideBottom', offset: -2, fill: labelColor, fontSize: 15 }}
              tick={input => {
                const category = props.barCategories?.[Number(input.payload?.value)];
                if (!category) return <g />;
                return <g transform={'translate(' + input.x + ',' + input.y + ')'}>
                  <text y={18} textAnchor="middle" fill={labelColor} fontSize={14}><title>{category.label}</title>{category.label.length > 17 ? category.label.slice(0, 16) + '…' : category.label}</text>
                  <text y={39} textAnchor="middle" fill="#e8f3ed" fontSize={14} fontWeight={600}><title>Total recorded kills in retained history</title>Total {category.total.toLocaleString()}</text>
                </g>;
              }} />
            <YAxis scale={useLog ? 'log' : 'linear'} domain={useLog ? [10 ** low, 10 ** high] : [0, Math.max(1, numbers.reduce((maximum, value) => Math.max(maximum, value), 0))]}
              allowDecimals={false} ticks={ticks} tickFormatter={metricFormat} tick={{ fontSize: 14 }} stroke={axisColor} tickLine={false} axisLine={false} width={78}
              label={{ value: props.yLabel, angle: -90, position: 'insideLeft', fill: labelColor, fontSize: 15, offset: -6 }} />
          </> : props.categoryAxis ? <>
            <XAxis type="number" tickFormatter={metricFormat} stroke={axisColor} tickLine={false} axisLine={false} tick={{ fontSize: 14 }} label={{ value: props.yLabel, position: 'insideBottom', offset: -25, fill: labelColor, fontSize: 15 }} />
            <YAxis dataKey="at" type="category" tickFormatter={props.xFormat} stroke={axisColor} axisLine={false} tickLine={false} width={148} interval={0} tick={{ fontSize: 14 }} label={{ value: props.xLabel, angle: -90, position: 'insideLeft', fill: labelColor, fontSize: 15, offset: -8 }} />
          </> : <>
            <XAxis dataKey="at" type="number" scale={useLogX ? 'log' : 'linear'} domain={xDomain || (props.data.length === 1 ? [props.data[0].at - 1, props.data[0].at + 1] : ['dataMin', 'dataMax'])} allowDecimals={props.type !== 'bar'} tickCount={5} tickFormatter={props.xFormat || timeTick}
              stroke={axisColor} axisLine={false} tickLine={false} minTickGap={28} tick={{ fontSize: 14 }} label={{ value: props.xLabel || 'Time', position: 'insideBottom', offset: -25, fill: labelColor, fontSize: 15 }} />
            <YAxis scale={useLog ? 'log' : 'linear'} domain={useLog ? [10 ** low, 10 ** high] : props.yDomain || [hasNegative ? 'auto' : 0, 'auto']} ticks={ticks} tickCount={5} tickFormatter={metricFormat}
              stroke={axisColor} axisLine={false} tickLine={false} width={78} tick={{ fontSize: 14 }} label={{ value: props.yLabel, angle: -90, position: 'insideLeft', fill: labelColor, fontSize: 15, offset: -6 }} />
          </>}
          <Tooltip contentStyle={{ background: '#0c1b15', border: '1px solid #3b5149', borderRadius: 10, color: '#e8f3ed', fontSize: 15, padding: '10px 14px' }} labelStyle={{ color: '#aabfb6', marginBottom: 5 }}
            labelFormatter={value => props.xFormat ? props.xFormat(Number(value)) : new Date(Number(value)).toLocaleString()} formatter={value => typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : value} />
          {props.references?.map(reference => <ReferenceLine key={reference.value} y={reference.value} stroke="#4b665a" strokeDasharray="5 5" label={{ value: reference.label, fill: '#94ad9e', fontSize: 13, position: 'insideTopRight' }} />)}
          {active.map(line => props.type === 'bar' ? <Bar key={line.key} dataKey={line.key} name={line.label} fill={line.color} radius={props.categoryAxis ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={props.barCategories ? 52 : 20} minPointSize={value => props.barCategories && typeof value === 'number' && value > 0 ? 3 : 0} isAnimationActive={false}>
              {props.barCategories && <LabelList valueAccessor={(_entry, index) => props.barCategories?.[index]?.rate || ''} position="top" offset={10} fill="#a5f3d0" fontSize={15} />}
            </Bar>
            : <Line key={line.key} dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={line.dash ? 2.5 : 2} strokeDasharray={line.dash} type="linear" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: '#0b1914' }} connectNulls={false} isAnimationActive={false} />)}
        </ComposedChart>
      </ResponsiveContainer>}
    </div>
    </div>
    <div className="mt-3 flex h-12 shrink-0 items-center border-t border-[#23392e] pt-2">
      {props.footer || <div className="flex min-w-0 gap-4 overflow-x-auto text-base text-[#aabfb6]" aria-label="Graph legend">{active.map(line => <span key={line.key} className="flex shrink-0 items-center gap-2"><span className="size-2 rounded-full" style={{ background: line.color }} />{line.label}</span>)}</div>}
    </div>
  </section>;
  return expanded ? <><div className="h-[460px] rounded-2xl border border-[#263d33]" />{createPortal(<div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={props.title} onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) setExpanded(false);
    if (event.key !== 'Tab') return;
    const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary');
    if (!controls?.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
  }}><div className="fixed inset-0 z-[99] bg-black/80 backdrop-blur-sm" onClick={() => setExpanded(false)} />{content}</div>, document.body)}</> : content;
}
