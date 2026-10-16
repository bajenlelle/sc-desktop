"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
import { pressable } from "@/lib/pressable";
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
      // eslint-disable-next-line @next/next/no-img-element -- remote league crests, sized by CSS
      <img
        src={team.logoUrl}
        alt=""
        style={style}
        className="shrink-0 rounded-full bg-white object-contain ring-1 ring-separator"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span
      style={style}
      className="flex shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold text-muted-foreground ring-1 ring-separator"
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
    <div className="grid gap-2">
      <SearchField
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search teams or clubs"
        spellCheck={false}
        autoCorrect="off"
        autoComplete="off"
        aria-label="Search teams or clubs"
      />
      <div
        className="h-72 overflow-y-auto rounded-window bg-card ring-1 ring-separator"
        role="listbox"
        aria-label="Teams"
      >
        {sections.length === 0 && (
          <p className="px-4 py-8 text-center text-callout text-muted-foreground">
            No teams match “{query.trim()}”. Try the club&apos;s name, or tell us your team isn&apos;t listed.
          </p>
        )}
        {sections.map((section) => (
          <div key={section.kind === "club" ? "club" : section.leagueId}>
            {/* Section headers float over the list as it scrolls under them. */}
            <div className="sticky top-0 z-10 border-b border-separator bg-material-toolbar px-3 py-1.5 text-subheadline font-medium text-muted-foreground backdrop-blur-xl">
              {section.kind === "club" ? "Your club's teams" : section.leagueName}
            </div>
            {section.teams.map((team) => {
              const selected = team.id === selectedId;
              return (
                <div
                  key={team.id}
                  {...pressable(() => onSelect(team))}
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full cursor-default items-center gap-3 px-3 py-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
                    selected && "bg-primary/12 hover:bg-primary/15",
                  )}
                >
                  <TeamCrest team={team} />
                  <span className="min-w-0 flex-1">
                    <TeamLabel team={team} />
                    {team.clubName && team.clubName !== team.name && (
                      <span className="block truncate text-callout text-muted-foreground">{team.clubName}</span>
                    )}
                  </span>
                  <Check
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0 stroke-[2.5] text-primary transition-[opacity,transform] duration-150",
                      selected ? "scale-100 opacity-100" : "scale-75 opacity-0",
                    )}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
