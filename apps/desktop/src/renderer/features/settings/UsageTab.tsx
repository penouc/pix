import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import type { UsageByModel, UsageSummary } from '@pi-desktop/protocol';

import { Segmented } from '@/components/ui/segmented';
import { invoke } from '@/lib/ipc';
import { formatCost, formatDurationMs, formatTokens, NOT_REPORTED } from '@/lib/status';
import { cn } from '@/lib/utils';

type Range = '30' | '90' | '365';

const RANGE_LABEL: Record<Range, string> = {
  '30': '30 days',
  '90': '90 days',
  '365': '1 year',
};

/** Cell size and gap, kept in one place so the grid and the legend agree. */
const CELL = 11;
const GAP = 3;

/**
 * Usage over time, by model, and by cost.
 *
 * Form choices, in the order the dataviz method prescribes:
 * - The calendar is a **heatmap** — magnitude across a date grid — so its colour
 *   job is *sequential*: one hue, light→dark, with the empty step allowed to
 *   recede toward the surface. See `--color-heat-*` in globals.css, which
 *   carries selected dark-theme steps rather than an automatic flip.
 * - The headline figures are a **KPI row of stat tiles**, not a bar chart: they
 *   are unrelated single values.
 * - Models are a **table with an inline cost meter**, not a categorical chart.
 *   Model counts run past the point where hues stay distinguishable, and a
 *   generated hue per model would be indistinguishable under CVD. The meter is
 *   one hue, so no categorical palette is introduced anywhere on this screen.
 */
export function UsageTab() {
  const [range, setRange] = useState<Range>('365');

  const usage = useQuery({
    queryKey: ['usage.summary', range],
    queryFn: () =>
      invoke<UsageSummary>({ method: 'usage.summary', params: { days: Number(range) } }),
  });

  const data = usage.data;
  const totals = data?.totals;
  const byDate = useMemo(
    () => new Map((data?.days ?? []).map((day) => [day.date, day])),
    [data?.days],
  );

  /** Weeks of days, oldest first, aligned so each column is one week. */
  const weeks = useMemo(() => {
    if (!data) return [];
    const end = new Date(data.to);
    end.setHours(0, 0, 0, 0);
    const start = new Date(data.from);
    start.setHours(0, 0, 0, 0);
    // Back up to Sunday so every column is a full week.
    start.setDate(start.getDate() - start.getDay());

    const columns: Array<Array<Date | null>> = [];
    let current: Array<Date | null> = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      current.push(new Date(cursor));
      if (current.length === 7) {
        columns.push(current);
        current = [];
      }
    }
    if (current.length) {
      while (current.length < 7) current.push(null);
      columns.push(current);
    }
    return columns;
  }, [data]);

  /**
   * Four filled steps by run count. Thresholds are quantile-ish off the busiest
   * day rather than fixed, so a light week is still legible.
   */
  const peak = useMemo(
    () => Math.max(1, ...(data?.days ?? []).map((day) => day.runs)),
    [data?.days],
  );
  function levelFor(runs: number): 0 | 1 | 2 | 3 | 4 {
    if (runs <= 0) return 0;
    const share = runs / peak;
    if (share <= 0.25) return 1;
    if (share <= 0.5) return 2;
    if (share <= 0.75) return 3;
    return 4;
  }

  const successRate =
    totals && totals.runs > 0 ? Math.round((totals.completed / totals.runs) * 100) : null;
  const costPeak = Math.max(...(data?.byModel ?? []).map((m) => m.costUsd), 0);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Segmented
          aria-label="Usage range"
          options={[
            { value: '30', label: RANGE_LABEL['30'] },
            { value: '90', label: RANGE_LABEL['90'] },
            { value: '365', label: RANGE_LABEL['365'] },
          ]}
          value={range}
          onChange={setRange}
        />
        <span className="flex-1" />
        {usage.isFetching ? <span className="text-[11px] text-muted">updating…</span> : null}
      </div>

      {/* KPI row — unrelated single values, so tiles rather than a chart. */}
      <div className="mb-6 grid grid-cols-4 gap-2.5">
        <Stat label="Spend" value={totals ? formatCost(totals.costUsd) : NOT_REPORTED} hero>
          {totals?.runs ? `over ${totals.runs.toLocaleString()} runs` : 'no runs yet'}
        </Stat>
        <Stat
          label="Tokens"
          value={totals ? formatTokens(totals.inputTokens + totals.outputTokens) : NOT_REPORTED}
        >
          {totals
            ? `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`
            : '—'}
        </Stat>
        <Stat label="Finished" value={successRate == null ? NOT_REPORTED : `${successRate}%`}>
          {totals ? `${totals.failed} failed · ${totals.cancelled} cancelled` : '—'}
        </Stat>
        <Stat label="Median run" value={formatDurationMs(totals?.medianDurationMs)}>
          wall clock, per run
        </Stat>
      </div>

      {/* Calendar heatmap */}
      <div className="mb-2 flex items-baseline justify-between">
        <h5>Runs per day</h5>
        <span className="text-[11px] text-muted">
          {totals?.runs ? `busiest day: ${peak} run${peak === 1 ? '' : 's'}` : 'nothing recorded'}
        </span>
      </div>
      <div
        className="mb-2 overflow-x-auto rounded-[18px] border border-border p-3.5"
        style={{ background: 'var(--color-heat-surface)' }}
      >
        <div style={{ minWidth: 'max-content' }}>
          {/* Month ruler — a column is labelled when its month differs from the
              previous column's, which is where the month actually starts. */}
          <div className="mb-1 flex" style={{ gap: `${GAP}px` }}>
            {weeks.map((week, index) => (
              <span
                key={index}
                className="inline-block shrink-0 text-[9px] whitespace-nowrap text-muted overflow-visible"
                style={{ width: CELL }}
              >
                {monthLabelFor(weeks, index)}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, index) => (
              <div key={index} className="flex flex-col" style={{ gap: `${GAP}px` }}>
                {week.map((day, dayIndex) => {
                  if (!day) {
                    return (
                      <span
                        key={dayIndex}
                        className="inline-block shrink-0"
                        style={{ width: CELL, height: CELL }}
                        aria-hidden="true"
                      />
                    );
                  }
                  const key = toLocalDate(day);
                  const entry = byDate.get(key);
                  const runs = entry?.runs ?? 0;
                  const level = levelFor(runs);
                  return (
                    <span
                      key={dayIndex}
                      // A native title is the tooltip here: it survives keyboard
                      // focus and screen readers, which a custom div would not.
                      title={`${key} · ${runs} run${runs === 1 ? '' : 's'}${
                        entry ? ` · ${formatCost(entry.costUsd)}` : ''
                      }`}
                      className="inline-block shrink-0 rounded-[3px]"
                      style={{
                        width: CELL,
                        height: CELL,
                        background: `var(--color-heat-${level})`,
                        boxShadow: 'inset 0 0 0 1px var(--color-heat-ring)',
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mb-6 flex items-center gap-1.5 text-[11px] text-muted">
        <span>Less</span>
        {/* Swatches carry the grid's own plate, or the darkest steps would be
            judged against the page background instead of the one they sit on. */}
        <span
          className="inline-flex items-center gap-1.5 rounded-[6px] px-1.5 py-1"
          style={{ background: 'var(--color-heat-surface)' }}
        >
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className="inline-block shrink-0 rounded-[3px]"
              style={{
                width: CELL,
                height: CELL,
                background: `var(--color-heat-${level})`,
                boxShadow: 'inset 0 0 0 1px var(--color-heat-ring)',
              }}
            />
          ))}
        </span>
        <span>More</span>
      </div>

      {/* By model — a table, deliberately not a categorical chart. */}
      <h5 className="mb-2">By model</h5>
      {data?.byModel.length ? (
        <div className="overflow-hidden rounded-[18px] border border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border text-left text-[10px] tracking-[0.1em] text-muted uppercase">
                <th className="px-3.5 py-2 font-semibold">Model</th>
                <th className="px-3.5 py-2 text-right font-semibold">Runs</th>
                <th className="px-3.5 py-2 text-right font-semibold">Tokens</th>
                <th className="w-[34%] px-3.5 py-2 font-semibold">Spend</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((model) => (
                <ModelRow
                  key={`${model.providerId}/${model.modelId}`}
                  model={model}
                  peak={costPeak}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-foreground/20 px-4 py-6 text-center text-[12.5px] text-muted">
          No runs recorded yet. Usage is written when a run finishes, so this fills in as you work.
        </div>
      )}

      <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
        Token and cost figures are whatever the provider reported for each run — some report
        neither, and those runs count toward Runs but not toward Spend. Nothing is estimated.
      </p>
    </>
  );
}

function ModelRow({ model, peak }: { model: UsageByModel; peak: number }) {
  const share = peak > 0 ? Math.max(0.02, model.costUsd / peak) : 0;
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-foreground/[0.03]">
      <td className="px-3.5 py-2.5">
        <div className="font-semibold">{model.modelId}</div>
        <div className="text-[11px] text-muted">{model.providerId}</div>
      </td>
      <td className="px-3.5 py-2.5 text-right font-mono">{model.runs.toLocaleString()}</td>
      <td className="px-3.5 py-2.5 text-right font-mono">
        {formatTokens(model.inputTokens + model.outputTokens)}
      </td>
      <td className="px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          {/* One hue, so this stays a magnitude meter rather than an identity colour. */}
          <span className="h-1.5 min-w-[2px] flex-1 overflow-hidden rounded-full bg-neutral-200">
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </span>
          <span className="w-[64px] flex-none text-right font-mono">
            {model.costUsd > 0 ? formatCost(model.costUsd) : NOT_REPORTED}
          </span>
        </div>
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  hero,
  children,
}: {
  label: string;
  value: string;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[18px] border border-border px-3.5 py-3">
      <div className="text-[10px] tracking-[0.1em] text-muted uppercase">{label}</div>
      <div className={cn('mt-1 leading-none font-bold', hero ? 'text-[26px]' : 'text-[20px]')}>
        {value}
      </div>
      {children ? <div className="mt-1 text-[11px] text-muted">{children}</div> : null}
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Label a column only where a new month begins, so the ruler stays sparse. */
function monthLabelFor(weeks: Array<Array<Date | null>>, index: number): string {
  const first = weeks[index]?.find((day): day is Date => day !== null);
  if (!first) return '';
  if (index === 0) return MONTHS[first.getMonth()]!;
  const previous = weeks[index - 1]?.find((day): day is Date => day !== null);
  if (previous && previous.getMonth() === first.getMonth()) return '';
  return MONTHS[first.getMonth()]!;
}

/** `YYYY-MM-DD` in local time, matching SQLite's `localtime` bucketing. */
function toLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
