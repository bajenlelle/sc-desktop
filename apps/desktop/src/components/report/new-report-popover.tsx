import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus, Loader2, Plus } from "lucide-react";
import { searchTeams } from "@scoutable/shared/lib/league-teams";
import { reportGameDay } from "@scoutable/shared/lib/team-report";
import type { ReportGame } from "@scoutable/shared/lib/report-draft";
import type { LeagueTeam } from "@scoutable/shared/types/league-team";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { useTeamCatalog } from "@/lib/my-team";
import { nextOpponent } from "@/lib/team-report";
import { useLeagues } from "@/lib/use-leagues";
import { useSpaceTeam } from "@/lib/use-my-team-ids";
import { useReportStarter } from "@/lib/use-team-report";
import { cn } from "@/lib/utils";

type NextOpponent = { competitionId: number; teamId: number; name: string; game: ReportGame };
type Option =
  | { kind: "blank"; key: string }
  | { kind: "next"; key: string; next: NextOpponent }
  | { kind: "team"; key: string; team: LeagueTeam }
  | { kind: "name"; key: string; name: string };

/** The space's next opponent, read when the popover first opens. */
function useNextOpponent(open: boolean): NextOpponent | null {
  const spaceTeamId = useSpaceTeam()?.id ?? null;
  const leagues = useLeagues();
  const [next, setNext] = useState<{ for: string; value: NextOpponent | null } | null>(null);
  useEffect(() => {
    if (!open || !spaceTeamId || leagues.length === 0 || next?.for === spaceTeamId) return;
    let cancelled = false;
    nextOpponent(spaceTeamId, leagues)
      .then((value) => !cancelled && setNext({ for: spaceTeamId, value }))
      .catch(() => !cancelled && setNext({ for: spaceTeamId, value: null }));
    return () => {
      cancelled = true;
    };
  }, [open, spaceTeamId, leagues, next?.for]);
  return next?.for === spaceTeamId ? next.value : null;
}

/**
 * Reports' New report: who the report is about. The space's next opponent
 * first, then this season's league teams (the space's own league first), and
 * any typed name for a team the Teams pages don't have. Grows from its button.
 */
export function NewReportPopover({ variant = "ghost" }: { variant?: "ghost" | "default" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const catalog = useTeamCatalog();
  const spaceTeam = useSpaceTeam();
  const next = useNextOpponent(open);
  const starter = useReportStarter();

  const options = useMemo<Option[]>(() => {
    const typed = query.trim();
    const teams = searchTeams(
      (catalog.teams ?? []).filter((t) => t.id !== spaceTeam?.id),
      typed,
    ).sort(
      (a, b) =>
        Number(b.leagueId === spaceTeam?.leagueId) - Number(a.leagueId === spaceTeam?.leagueId) ||
        a.leagueName.localeCompare(b.leagueName, "sv") ||
        a.name.localeCompare(b.name, "sv"),
    );
    // A report on no team comes first, always: picked by Enter on an empty field.
    const out: Option[] = [{ kind: "blank", key: "blank" }];
    if (next && (!typed || next.name.toLowerCase().includes(typed.toLowerCase()))) out.push({ kind: "next", key: "next", next });
    for (const t of teams) out.push({ kind: "team", key: t.id, team: t });
    if (typed && !teams.some((t) => t.name.toLowerCase() === typed.toLowerCase())) out.push({ kind: "name", key: "name", name: typed });
    return out;
  }, [catalog.teams, query, spaceTeam?.id, spaceTeam?.leagueId, next]);

  // Typing moves to the first team that matches; an empty field rests on Blank report.
  useEffect(() => setActive(query.trim() && options.length > 1 ? 1 : 0), [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (o: Option) => {
    const done =
      o.kind === "blank"
        ? await starter.blank()
        : o.kind === "next"
        ? await starter.forTeam({ competitionId: o.next.competitionId, teamId: o.next.teamId }, o.next.game)
        : o.kind === "team"
          ? await starter.forLeagueTeam(o.team.id)
          : await starter.forName(o.name);
    if (done) {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size="sm">
          <Plus />
          New report
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={variant === "ghost" ? "end" : "center"}
        side="bottom"
        className="w-80 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="px-3 pt-3 pb-1">
          <p className="text-headline">New report</p>
          <p className="text-subheadline text-muted-foreground">Pick a team and its players come filled in.</p>
        </div>
        <div className="p-2">
          <SearchField
            ref={inputRef}
            placeholder="Search teams or type a name"
            aria-label="Opponent"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => Math.max(0, Math.min(options.length - 1, i + step)));
              } else if (e.key === "Enter" && options[active]) {
                e.preventDefault();
                void choose(options[active]);
              }
            }}
          />
        </div>
        {/* Blank report is there before the teams are read. */}
        <div role="listbox" aria-label="Opponents" className="max-h-72 overflow-y-auto px-1 pb-1">
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              role="option"
              aria-selected={i === active}
              disabled={starter.busy}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(o)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors duration-100 disabled:opacity-50",
                i === active ? "bg-fill-2" : "hover:bg-fill-1",
              )}
            >
              {o.kind === "blank" ? (
                <>
                  <FilePlus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">Blank report</span>
                    <span className="block truncate text-subheadline text-muted-foreground">No team: add sections and clips yourself</span>
                  </span>
                </>
              ) : o.kind === "name" ? (
                <>
                  <Plus className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    New report for &ldquo;<span className="font-medium">{o.name}</span>&rdquo;
                  </span>
                </>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{o.kind === "next" ? o.next.name : o.team.name}</span>
                  <span className="block truncate text-subheadline text-muted-foreground">
                    {o.kind === "next" ? `Your next game · ${reportGameDay(o.next.game.at)}` : o.team.leagueName}
                  </span>
                </span>
              )}
              {starter.busy && i === active && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
            </button>
          ))}
        </div>
        {catalog.teams === null && !catalog.failed && (
          <p className="flex items-center gap-2 px-3 pb-3 text-callout text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading teams…
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
