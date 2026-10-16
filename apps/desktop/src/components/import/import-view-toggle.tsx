import { cn } from "@/lib/utils";
import { TeamCrest } from "@/components/team-picker";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";

export type ImportView = "team" | "all";

/** "Your games" (the space's team) or every game in a league. */
export function ImportViewToggle({
  team,
  view,
  onChange,
}: {
  team: LeagueTeam;
  view: ImportView;
  onChange: (view: ImportView) => void;
}) {
  const segment = (active: boolean) =>
    cn(
      "flex min-w-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
      active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div role="tablist" aria-label="Which games" className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted p-1">
      <button type="button" role="tab" aria-selected={view === "team"} className={segment(view === "team")} onClick={() => onChange("team")}>
        <TeamCrest team={team} size={18} />
        <span className="truncate">{team.name}</span>
      </button>
      <button type="button" role="tab" aria-selected={view === "all"} className={segment(view === "all")} onClick={() => onChange("all")}>
        All games
      </button>
    </div>
  );
}
