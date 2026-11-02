import { Check } from "lucide-react";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { periodLabel } from "@scoutable/shared/lib/events";
import type { PeriodRow } from "@scoutable/shared/lib/period-sync";
import { formatMSSd, type AnchorCopy } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { useHotkeys } from "@/lib/key-scope";
import { cn } from "@/lib/utils";

/** The picker's words for a quarter, by what its anchor is. */
export function quarterCopy(row: PeriodRow): Partial<AnchorCopy> {
  const confirmed = `${row.name} set at`;
  if (row.anchor?.kind === "period_start") {
    return {
      title: `Set the start of ${row.name}`,
      instruction: "Find the frame where the game clock starts, then set it.",
      button: `Set ${row.name} start here`,
      confirmed,
    };
  }
  if (row.anchor?.kind === "first_basket") {
    return {
      title: `Set ${row.name}'s first basket`,
      instruction: "Find the frame where the ball drops through the net, then set it.",
      button: `Set ${row.name} here`,
      confirmed,
    };
  }
  return {
    title: `Set ${row.name}`,
    instruction: "Find the play, then set it.",
    button: `Set ${row.name} here`,
    confirmed,
  };
}

/** A span of video as m:ss, or h:mm:ss past the hour. */
export function formatSpan(secs: number): string {
  const t = Math.round(Math.abs(secs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "Q3 and Q4 follow Q2.", for the quarters left without their own sync. */
export function followsSummary(rows: PeriodRow[]): string | null {
  const unset = rows.filter((r) => !r.set);
  if (unset.length === 0) return null;
  const groups = new Map<number, string[]>();
  for (const r of unset) groups.set(r.follows, [...(groups.get(r.follows) ?? []), r.name]);
  const parts = [...groups].map(([follows, names]) => {
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return `${list} follow${names.length === 1 ? "s" : ""} ${periodLabel(follows)}`;
  });
  return `${parts.join("; ")}.`;
}

/**
 * Quarter-by-quarter sync for a video that skips the breaks: a switch (set
 * by detection, the coach's to change), then one row per period. The row
 * picked is the one the picker above is setting; ↑/↓ move between rows
 * while the picker has the keys. Q1 is the game's own sync point.
 */
export function QuarterSyncPanel({
  q1Label,
  q1Time,
  rows,
  active,
  breaksCut,
  detection,
  onToggle,
  onSelect,
  onSkip,
}: {
  /** "Tip-off" or "First basket". */
  q1Label: string;
  q1Time: number | null;
  rows: PeriodRow[];
  active: number;
  breaksCut: boolean;
  detection: { cut: boolean; overrunSeconds: number } | null;
  onToggle: (on: boolean) => void;
  onSelect: (period: number) => void;
  onSkip: (period: number) => void;
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
    breaksCut && rows.length > 0,
  );

  const caption = detection?.cut
    ? `The play-by-play runs ${formatSpan(detection.overrunSeconds)} past the end of this video, so the breaks look cut out. Each quarter gets its own sync.`
    : breaksCut
      ? "Each quarter gets its own sync. A quarter you skip follows the one before it."
      : "For a video with the breaks cut out: each quarter then gets its own sync.";

  const status = (set: boolean, time: number | null, follows: number | null, suggested: number | null, isActive: boolean) =>
    set && time !== null ? (
      <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
        <Check className="size-3.5" strokeWidth={3} />
        Set at <span className="nums">{formatMSSd(time)}</span>
      </span>
    ) : isActive && suggested !== null ? (
      <span>
        Suggested <span className="nums">{formatSpan(suggested)}</span>
      </span>
    ) : follows !== null ? (
      <span>Follows {periodLabel(follows)}</span>
    ) : (
      <span>Not set</span>
    );

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <Switch id="breaks-cut" checked={breaksCut} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="min-w-0">
          <label htmlFor="breaks-cut" className="text-callout font-medium text-foreground">
            The video skips the breaks between quarters
          </label>
          <p className="text-footnote text-muted-foreground">{caption}</p>
        </div>
      </div>

      {breaksCut && rows.length > 0 && (
        <div>
          <ul className="divide-y divide-separator overflow-hidden rounded-lg ring-1 ring-separator">
            {[{ period: 1, name: "Q1", label: q1Label, set: q1Time !== null, time: q1Time, follows: null, suggested: null }, ...rows.map((r) => ({
              period: r.period,
              name: r.name,
              label: r.anchor?.label ?? "",
              set: r.set,
              time: r.videoTime,
              follows: r.follows,
              suggested: r.suggested,
            }))].map((row) => {
              const isActive = row.period === active;
              return (
                <li key={row.period} className={cn("flex items-center", isActive ? "bg-fill-2" : "hover:bg-fill-1")}>
                  <button
                    type="button"
                    aria-current={isActive || undefined}
                    onClick={() => onSelect(row.period)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
                  >
                    <span className="w-9 shrink-0 text-subheadline font-semibold text-foreground nums">{row.name}</span>
                    <span className="min-w-0 flex-1 truncate text-callout text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 text-callout text-muted-foreground">
                      {status(row.set, row.time, row.follows, row.suggested, isActive)}
                    </span>
                  </button>
                  {isActive && row.period > 1 && !row.set && (
                    <Button variant="ghost" size="sm" className="mr-1.5 shrink-0" onClick={() => onSkip(row.period)}>
                      Skip {row.name}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 flex items-center gap-1 text-footnote text-muted-foreground">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            change quarter. A quarter you skip follows the one before it.
          </p>
        </div>
      )}
    </div>
  );
}
