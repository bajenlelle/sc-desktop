"use client";

/**
 * "Leaders" quick-filter for the add-clips panel: ranked per-player lists
 * (top scorers, assists, rebounds, …) computed from the play-by-play in
 * memory, so a coach can pick "their top scorer" without knowing any names.
 * Selecting a row toggles the player in the Player filter; leaders add no
 * new filter semantics, they're a smarter way to fill that one. Stays open
 * for several picks.
 */
import { useMemo, useState } from "react";
import { Check, Trophy } from "lucide-react";
import { computeLeaders, LEADER_METRICS, type LeaderMetric } from "@scoutable/shared/lib/leaders";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export function LeadersPopover({
  events,
  selectedPlayers,
  onTogglePlayer,
  disabled,
}: {
  /** Events already narrowed by the panel's Game + Team filters. */
  events: readonly PlayByPlayEvent[];
  /** The Player filter's current selection (display-name strings). */
  selectedPlayers: ReadonlySet<string>;
  onTogglePlayer: (name: string) => void;
  disabled?: boolean;
}) {
  const [metric, setMetric] = useState<LeaderMetric>("points");
  const leaders = useMemo(() => computeLeaders([...events], metric), [events, metric]);
  const active = LEADER_METRICS.find((m) => m.id === metric) ?? LEADER_METRICS[0];

  function pick(name: string) {
    if (!selectedPlayers.has(name)) trackEvent("clip_leaders_used", { metric, origin: "web" });
    onTogglePlayer(name);
  }

  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md bg-card px-2.5 text-sm text-foreground shadow-xs ring-1 ring-separator outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-50 data-[state=open]:bg-fill-2 pointer-coarse:h-9",
            selectedPlayers.size > 0 && "text-primary",
          )}
        >
          <Trophy className="size-3.5 text-muted-foreground" aria-hidden />
          Leaders
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-separator px-3 py-2">
          <p className="text-headline text-foreground">Game leaders</p>
          <p className="text-callout text-muted-foreground">Pick the game&apos;s top performers to filter by.</p>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-separator px-3 py-2">
          {LEADER_METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMetric(m.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium outline-none transition-[background-color,color,transform] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection",
                m.id === metric ? "bg-selection text-selection-foreground" : "bg-fill-1 text-muted-foreground hover:bg-fill-2 hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {leaders.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No {active.label.toLowerCase()} recorded in this game yet.</p>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {leaders.map((row, i) => {
              const picked = selectedPlayers.has(row.name);
              return (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => pick(row.name)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:bg-fill-1"
                >
                  {picked ? (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  ) : (
                    <span className="size-4 shrink-0 rounded-sm ring-1 ring-separator-strong" />
                  )}
                  <span className="w-5 shrink-0 text-right text-xs nums text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{row.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.teamName || "—"}</span>
                  </span>
                  <span className="shrink-0 text-sm nums text-foreground">
                    {row.value} <span className="text-xs text-muted-foreground">{active.unit}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
