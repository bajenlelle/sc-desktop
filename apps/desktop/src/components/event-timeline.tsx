import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GameEvent, Team } from "@/types/match";

const outcomeStyles: Record<string, string> = {
  success: "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950",
  miss: "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950",
  turnover: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950",
  foul: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950",
};

export function EventTimeline({
  events,
  homeTeam,
  awayTeam,
}: {
  events: GameEvent[];
  homeTeam: Team;
  awayTeam: Team;
}) {
  const teamColor = (teamId: string) =>
    teamId === homeTeam.id ? homeTeam.color : awayTeam.color;

  return (
    <div className="space-y-1">
      {events.map((event, i) => (
        <div
          key={event.id}
          className={cn(
            "group flex items-center gap-4 rounded-lg px-4 py-3 transition-colors hover:bg-muted",
            i % 2 === 0 ? "bg-card" : "bg-muted/50"
          )}
        >
          {/* Timestamp */}
          <div className="flex w-16 shrink-0 items-center justify-center">
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs font-semibold text-muted-foreground">
              {event.timestamp}
            </span>
          </div>

          {/* Team color dot */}
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: teamColor(event.teamId) }}
          />

          {/* Player info */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="font-medium text-foreground">
              {event.playerName}
            </span>
            <span className="text-xs text-muted-foreground">
              #{event.jerseyNumber}
            </span>
          </div>

          {/* Event type */}
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {event.type
              .split("_")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ")}
          </span>

          {/* Outcome badge */}
          <span
            className={cn(
              "inline-flex w-20 items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              outcomeStyles[event.outcome] ?? "text-muted-foreground bg-muted"
            )}
          >
            {event.outcome === "success"
              ? "Made"
              : event.outcome === "miss"
                ? "Missed"
                : event.outcome.charAt(0).toUpperCase() + event.outcome.slice(1)}
          </span>

          {/* Play clip button */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            title="Play clip"
          >
            <Play className="h-3.5 w-3.5 text-primary" />
          </Button>
        </div>
      ))}
    </div>
  );
}
