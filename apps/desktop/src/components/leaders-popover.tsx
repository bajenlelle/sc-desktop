/**
 * "Leaders" quick-filter for the clip browser: ranked per-player lists (top
 * scorers, assists, rebounds, …) computed from the play-by-play in memory,
 * so a coach can pick "their top scorer" without knowing any names. Selecting
 * a row toggles the player in the existing Player filter — leaders add no new
 * filter semantics, they're a smarter way to fill that one. Stays open for
 * multi-pick, mirroring LabelPickerPopover.
 */
import { useMemo, useState } from "react";
import { Check, Trophy } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/lib/analytics";
import type { PlayByPlayEvent } from "@scoutable/shared/types/match";
import {
  computeLeaders,
  LEADER_METRICS,
  type LeaderMetric,
} from "@scoutable/shared/lib/leaders";

export function LeadersPopover({
  events,
  selectedPlayers,
  onTogglePlayer,
}: {
  /** Events already narrowed by the browser's Game + Team filters. */
  events: PlayByPlayEvent[];
  /** The Player filter's current selection (display-name strings). */
  selectedPlayers: Set<string>;
  onTogglePlayer: (name: string) => void;
}) {
  const [metric, setMetric] = useState<LeaderMetric>("points");
  const leaders = useMemo(() => computeLeaders(events, metric), [events, metric]);
  const active = LEADER_METRICS.find((m) => m.id === metric) ?? LEADER_METRICS[0];

  function handleRowClick(name: string) {
    if (!selectedPlayers.has(name)) {
      trackEvent("clip_leaders_used", { metric });
    }
    onTogglePlayer(name);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-transparent px-3 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          <Trophy className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          Leaders
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">Game leaders</p>
          <p className="text-xs text-muted-foreground">
            Pick this game&apos;s top performers to filter by.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {LEADER_METRICS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMetric(m.id)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs transition-colors",
                m.id === metric
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {leaders.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No {active.label.toLowerCase()} recorded in this game yet.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {leaders.map((row, i) => {
              const picked = selectedPlayers.has(row.name);
              return (
                <button
                  key={row.name}
                  type="button"
                  onClick={() => handleRowClick(row.name)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/40"
                >
                  {picked ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-sm border border-border" />
                  )}
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">{row.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.teamName || "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-foreground">
                    {row.value}{" "}
                    <span className="text-xs text-muted-foreground">{active.unit}</span>
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
