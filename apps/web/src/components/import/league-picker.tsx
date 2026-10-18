"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { countryFlag, groupLeagues } from "@scoutable/shared/lib/league-schedule";
import type { League } from "@scoutable/shared/types/league";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";

/**
 * Searchable league selector. The league list is the one picker on the
 * import page expected to grow past ~15 options, so it gets a filter field;
 * season and stage stay pop-up buttons. Options are grouped by country for
 * national leagues and by district for Profixio's district leagues.
 */
export function LeaguePicker({
  leagues,
  value,
  onChange,
  className,
}: {
  leagues: League[];
  value: League | null;
  onChange: (league: League) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupLeagues(leagues, query), [leagues, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Each opening starts with the whole list.
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="League"
          className={cn(
            "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-card pr-1.5 pl-2.5 text-sm text-foreground shadow-xs ring-1 ring-separator outline-none",
            "transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.98] active:bg-fill-2 data-[state=open]:bg-fill-2",
            "focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:h-9 pointer-coarse:rounded-lg",
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
        className="w-72 p-0"
        onOpenAutoFocus={(e) => {
          // A mouse user types at once; a phone keeps its keyboard down until asked.
          if (window.matchMedia("(pointer: fine)").matches) {
            e.preventDefault();
            inputRef.current?.focus();
          }
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
          {groups.length === 0 && <p className="px-3 py-4 text-center text-callout text-muted-foreground">No leagues match.</p>}
          {groups.map(([groupName, groupLeagues]) => (
            <div key={groupName}>
              <div className="px-3 py-1.5 text-subheadline font-medium text-muted-foreground">{groupName}</div>
              {groupLeagues.map((league) => (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => {
                    onChange(league);
                    setOpen(false);
                  }}
                  className={cn(
                    "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-[5px] px-2 py-1 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 focus-visible:bg-fill-1 pointer-coarse:py-2",
                    league.id === value?.id && "bg-primary/10",
                  )}
                >
                  <span aria-hidden>{countryFlag(league.country)}</span>
                  <span className="flex-1 truncate">{league.name}</span>
                  {league.id === value?.id && <Check className="size-3.5 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
