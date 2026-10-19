"use client";

import { Check } from "lucide-react";
import { formatMSSd } from "@scoutable/shared/lib/clip-timing";
import { periodLabel } from "@scoutable/shared/lib/events";
import { clamp } from "@scoutable/shared/lib/motion-math";
import type { PeriodRow } from "@scoutable/shared/lib/period-sync";
import { formatSpan } from "@/components/sync/sync-words";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { useHotkeys } from "@/lib/key-scope";
import { cn } from "@/lib/utils";

/**
 * Quarter-by-quarter sync for a video that skips the breaks, the desktop's
 * panel on the web: a switch (turned on by detection or by the coach), then
 * one row per period. The row picked is the one the picker above sets; ↑/↓
 * move between rows while the picker has the keys. Q1 is the game's own
 * sync point; a quarter without its own follows the nearest earlier one.
 */
export function QuarterSyncPanel({
  q1Label,
  q1Time,
  rows,
  active,
  breaksCut,
  detection,
  busy = false,
  onToggle,
  onSelect,
  onSkip,
  onClear,
}: {
  /** What Q1's sync refers to: "Tip-off", or the first basket's label. */
  q1Label: string;
  q1Time: number | null;
  rows: PeriodRow[];
  /** The period the picker sets now (1 = the tip-off); 0 = none. */
  active: number;
  breaksCut: boolean;
  detection: { cut: boolean; overrunSeconds: number } | null;
  /** A write is on its way: the controls wait. */
  busy?: boolean;
  onToggle: (on: boolean) => void;
  onSelect: (period: number) => void;
  /** Leave a quarter to follow the one before it, and go on to the next. */
  onSkip: (period: number) => void;
  /** Drop a quarter's own sync: it follows the one before it again. */
  onClear: (period: number) => void;
}) {
  useHotkeys(
    "tipoff",
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const order = [1, ...rows.map((r) => r.period)];
      const i = Math.max(0, order.indexOf(active));
      const next = order[clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, order.length - 1)];
      if (next !== active) onSelect(next);
    },
    breaksCut && rows.length > 0 && !busy,
  );

  const caption = detection?.cut
    ? `The play-by-play runs ${formatSpan(detection.overrunSeconds)} past the end of this video, so the breaks look cut out. Each quarter gets its own sync.`
    : breaksCut
      ? "Each quarter gets its own sync. A quarter you skip follows the one before it."
      : "For a video with the breaks cut out: each quarter then gets its own sync.";

  const list = [
    { period: 1, name: "Q1", label: q1Label, set: q1Time !== null, time: q1Time, follows: null as number | null, suggested: null as number | null },
    ...rows.map((r) => ({
      period: r.period,
      name: r.name,
      label: r.anchor?.label ?? "",
      set: r.set,
      time: r.videoTime,
      follows: r.follows as number | null,
      suggested: r.suggested,
    })),
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Switch id="breaks-cut" checked={breaksCut} disabled={busy} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="min-w-0">
          <label htmlFor="breaks-cut" className="text-callout font-medium text-foreground">
            The video skips the breaks between quarters
          </label>
          <p className="text-footnote text-muted-foreground">{caption}</p>
        </div>
      </div>

      {breaksCut && rows.length > 0 && (
        <div>
          <ul className="divide-y divide-separator overflow-hidden rounded-window bg-card ring-1 ring-separator">
            {list.map((row) => {
              const isActive = row.period === active;
              return (
                <li key={row.period} className={cn("flex items-center transition-colors duration-100", isActive ? "bg-fill-2" : "hover:bg-fill-1")}>
                  <button
                    type="button"
                    aria-current={isActive || undefined}
                    disabled={busy}
                    onClick={() => onSelect(row.period)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left outline-none active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection disabled:opacity-60"
                  >
                    <span className="w-9 shrink-0 text-subheadline font-semibold text-foreground nums">{row.name}</span>
                    <span className="min-w-0 flex-1 truncate text-callout text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 text-callout text-muted-foreground">
                      {row.set && row.time !== null ? (
                        <span className="flex items-center gap-1.5 text-success">
                          <Check className="size-3.5" strokeWidth={3} />
                          Set at <span className="nums">{formatMSSd(row.time)}</span>
                        </span>
                      ) : isActive && row.suggested !== null ? (
                        <span>
                          Suggested <span className="nums">{formatSpan(row.suggested)}</span>
                        </span>
                      ) : row.follows !== null ? (
                        <span>Follows {periodLabel(row.follows)}</span>
                      ) : (
                        <span>Not set</span>
                      )}
                    </span>
                  </button>
                  {isActive && row.period > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mr-1.5 shrink-0"
                      disabled={busy}
                      aria-label={row.set ? `Clear ${row.name}'s own sync` : undefined}
                      onClick={() => (row.set ? onClear(row.period) : onSkip(row.period))}
                    >
                      {row.set ? "Clear" : `Skip ${row.name}`}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-footnote text-muted-foreground">
            <span className="hidden items-center gap-1 pointer-fine:inline-flex">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              change quarter.
            </span>
            A quarter you skip or clear follows the one before it.
          </p>
        </div>
      )}
    </div>
  );
}
