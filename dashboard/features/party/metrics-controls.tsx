'use client';
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export const metricsControl = 'inline-flex h-11 min-w-0 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#30433f] bg-[#10201d] px-3 text-base font-medium text-[#e5eeea] outline-none transition-colors hover:border-[#58766c] hover:bg-[#18302a] focus-visible:ring-2 focus-visible:ring-emerald-400/60 disabled:cursor-not-allowed disabled:opacity-40';
export const metricsIconControl = metricsControl + ' size-11 p-0';
export const metricsMenu = 'max-h-[70vh] w-96 overflow-y-auto rounded-xl border border-[#3b5149] bg-[#0d1d18] p-4 text-[#e5eeea] shadow-2xl';

export function MetricsSelect({ label, value, onChange, options, className = '' }: {
  label: string; value: string; onChange(value: string): void;
  options: { value: string; label: string; disabled?: boolean }[]; className?: string;
}) {
  return <select aria-label={label} title={label + ': ' + (options.find(option => option.value === value)?.label || value)} className={cn(metricsControl, 'max-w-40 truncate', className)}
    value={value} onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select>;
}
export function MetricsMenu({ label, trigger, children, className = metricsIconControl }: { label: string; trigger: ReactNode; children: ReactNode; className?: string }) {
  return <Popover><PopoverTrigger className={className} aria-label={label} title={label}>{trigger}</PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} positionerClassName="z-[130]" className={metricsMenu + ' max-w-[calc(100vw-32px)]'}>
      {children}
    </PopoverContent>
  </Popover>;
}
