import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { SearchField } from "@/components/ui/search-field";
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
            "flex h-7 items-center gap-1.5 rounded-md bg-card pr-1.5 pl-2.5 text-sm shadow-xs ring-1 ring-separator outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] data-[state=open]:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection",
            className,
          )}
        >
          {value && <span aria-hidden>{countryFlag(value.country)}</span>}
          <span className="truncate">{value?.name ?? "Choose a league"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
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
        <div className="border-b border-separator p-2">
          <SearchField
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search leagues"
            aria-label="Search leagues"
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {groups.length === 0 && (
            <p className="px-3 py-4 text-center text-callout text-muted-foreground">No leagues match.</p>
          )}
          {groups.map(([groupName, groupLeagues]) => (
            <div key={groupName}>
              <div className="px-3 py-1.5 text-subheadline font-medium text-muted-foreground">
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
                  className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-[5px] px-2 py-1 text-left text-sm outline-none hover:bg-selection hover:text-selection-foreground focus-visible:bg-selection focus-visible:text-selection-foreground"
                >
                  <span aria-hidden>{countryFlag(league.country)}</span>
                  <span className="flex-1 truncate">{league.name}</span>
                  {league.id === value?.id && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
