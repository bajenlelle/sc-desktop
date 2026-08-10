import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  COUNTRY_NAMES,
  NATIONAL_TEAM_LEAGUES,
  countryFlag,
  type League,
} from "@/lib/basketball-api";
import { cn } from "@/lib/utils";

const NT_GROUP = "National teams";

const NT_LEAGUE_IDS = new Set(NATIONAL_TEAM_LEAGUES.map((l) => l.id));

function groupNameFor(league: League): string {
  if (NT_LEAGUE_IDS.has(league.id)) return NT_GROUP;
  return COUNTRY_NAMES[league.country] ?? league.country;
}

interface LeaguePickerProps {
  leagues: League[];
  value: League | null;
  onChange: (league: League) => void;
  className?: string;
}

/**
 * Searchable league selector. The league list is the one picker on the
 * import page expected to grow past ~15 options, so it gets a filter field;
 * season and stage stay simple dropdowns.
 *
 * Options are grouped by country (national-team leagues group separately),
 * matching how sports-data tools present large competition lists.
 */
export function LeaguePicker({ leagues, value, onChange, className }: LeaguePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? leagues.filter(
          (l) =>
            l.name.toLowerCase().includes(q) ||
            groupNameFor(l).toLowerCase().includes(q),
        )
      : leagues;

    const byGroup = new Map<string, League[]>();
    for (const league of matches) {
      const key = groupNameFor(league);
      const list = byGroup.get(key) ?? [];
      list.push(league);
      byGroup.set(key, list);
    }
    // Countries alphabetically; national teams always last.
    return Array.from(byGroup.entries()).sort(([a], [b]) => {
      if (a === NT_GROUP) return 1;
      if (b === NT_GROUP) return -1;
      return a.localeCompare(b);
    });
  }, [leagues, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
            className,
          )}
        >
          {value && <span aria-hidden>{countryFlag(value.country)}</span>}
          <span className="truncate">{value?.name ?? "Select league"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leagues…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {groups.length === 0 && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              No leagues found.
            </p>
          )}
          {groups.map(([groupName, groupLeagues]) => (
            <div key={groupName}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {groupName}
              </div>
              {groupLeagues.map((league) => (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => {
                    onChange(league);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent/40"
                >
                  <span aria-hidden>{countryFlag(league.country)}</span>
                  <span className="flex-1 truncate">{league.name}</span>
                  {league.id === value?.id && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
