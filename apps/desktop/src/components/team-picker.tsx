import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { groupTeams, searchTeams } from "@scoutable/shared/lib/league-teams";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * A team's crest. Round on purpose: spaces use square icons, so a team never
 * looks like a space.
 */
export function TeamCrest({ team, size = 28 }: { team: Pick<LeagueTeam, "name" | "logoUrl">; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (team.logoUrl && !broken) {
    return (
      <img
        src={team.logoUrl}
        alt=""
        style={style}
        className="shrink-0 rounded-full bg-white object-contain ring-1 ring-border"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-1 ring-border"
    >
      {initials(team.name)}
    </span>
  );
}

/** Team name with its league, the pair that tells "Sollentuna Basket" the team from a space. */
export function TeamLabel({ team, className }: { team: LeagueTeam; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="truncate font-medium text-foreground">{team.name}</span>
      <Badge variant="outline" className="font-normal text-muted-foreground">
        {team.leagueName}
      </Badge>
    </span>
  );
}

interface TeamPickerProps {
  teams: LeagueTeam[];
  suggestedIds: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (team: LeagueTeam) => void;
}

export function TeamPicker({ teams, suggestedIds, selectedId, onSelect }: TeamPickerProps) {
  const [query, setQuery] = useState("");
  const sections = useMemo(
    () => groupTeams(searchTeams(teams, query), suggestedIds),
    [teams, query, suggestedIds],
  );

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teams or clubs"
          spellCheck={false}
          autoCorrect="off"
          autoComplete="off"
          className="pl-8"
          aria-label="Search teams or clubs"
        />
      </div>
      <div className="h-72 overflow-y-auto rounded-md border border-border" role="listbox" aria-label="Teams">
        {sections.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No teams match &ldquo;{query.trim()}&rdquo;. Try the club name, or tell us your team isn&apos;t listed.
          </p>
        )}
        {sections.map((section) => (
          <div key={section.kind === "club" ? "club" : section.leagueId}>
            <div className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
              {section.kind === "club" ? "Your club's teams" : section.leagueName}
            </div>
            {section.teams.map((team) => {
              const selected = team.id === selectedId;
              return (
                <button
                  key={team.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(team)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                    selected && "bg-primary/10 hover:bg-primary/15",
                  )}
                >
                  <TeamCrest team={team} />
                  <span className="min-w-0 flex-1">
                    <TeamLabel team={team} />
                    {team.clubName && team.clubName !== team.name && (
                      <span className="block truncate text-xs text-muted-foreground">{team.clubName}</span>
                    )}
                  </span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
