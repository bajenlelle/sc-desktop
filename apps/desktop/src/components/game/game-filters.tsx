import * as React from "react";
import { Check, Plus } from "lucide-react";
import type { PlayerGroup } from "@scoutable/shared/lib/clip-filters";
import type { GameMoment } from "@scoutable/shared/lib/game-flow";
import { EMPTY_GAME_FILTERS, type GameFilters } from "@scoutable/shared/lib/game-list";
import type { Label } from "@scoutable/shared/types/labels";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { FilterToken, PlaysFilterBar } from "@/components/plays/plays-filter-bar";
import { PlaysCountLine } from "@/components/plays/plays-count-line";

export interface GamePerson {
  id: number;
  name: string;
  number: string | null;
  side: 1 | 2;
}

/**
 * What the game's list shows, in the bar every list of plays has (PlaysFilterBar): whose plays (both teams or
 * one), Filter (players, shot types, situations, quarters and moments, labels; ⌘F) and Presets; the event
 * chips; a token for each filter that is on. Under them the count line (PlaysCountLine): how many plays are
 * listed, and once anything narrows the list, Clear filters and Add all.
 */
export function GameFilterBar({
  filters,
  onChange,
  teams,
  momentCounts,
  timeouts,
  periods,
  players,
  labels,
  visible,
  total,
  filtered,
  addable,
  targetName,
  onAddAll,
  searchRef,
  sheetOpen,
  onSheetOpenChange,
  presetsMenu,
}: {
  filters: GameFilters;
  onChange: (next: GameFilters) => void;
  teams: { home: string; away: string };
  /** How many plays each moment has in this game. */
  momentCounts: Readonly<Record<GameMoment, number>>;
  /** Whether the game's timeouts are known: "ready", still being "read", or "none" on record. */
  timeouts: "ready" | "reading" | "none";
  periods: readonly number[];
  /** The game's players by team, keyed by playerKey. */
  players: readonly PlayerGroup[];
  labels: readonly Label[];
  /** Plays listed now. */
  visible: number;
  /** Plays in the game, for "24 of 430 plays". */
  total: number;
  filtered: boolean;
  /** Of the listed plays, how many aren't in the target yet. */
  addable: number;
  targetName: string | null;
  onAddAll: (anchor: HTMLElement) => void;
  searchRef: React.Ref<HTMLInputElement>;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  /** The saved filters (FilterPresetsMenu). */
  presetsMenu?: React.ReactNode;
}) {
  const play = filters.play;
  const onePlayer = play.players.size === 1 ? [...play.players][0] : null;
  const onePlayerName = onePlayer ? (players.flatMap((g) => g.players).find((p) => p.key === onePlayer)?.name ?? null) : null;
  const why: Partial<Record<GameMoment, string>> = {};
  if (timeouts !== "ready") why.after_timeout = timeouts === "reading" ? "Reading the game's timeouts…" : "This game has no timeouts on record.";

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-separator px-3 pt-3 pb-1">
      <PlaysFilterBar
        filters={play}
        onChange={(next) => onChange({ ...filters, play: next, onCourt: next.players.size === 1 ? filters.onCourt : false })}
        scopeFill
        scope={
          <SegmentedControl
            aria-label="Team"
            className="min-w-0 flex-1 [&>button]:min-w-0 [&>button]:flex-1 [&>button>span]:min-w-0"
            value={String(filters.team) as "0" | "1" | "2"}
            onValueChange={(v) => onChange({ ...filters, team: Number(v) as 0 | 1 | 2 })}
            options={[
              { value: "0", label: "Both" },
              { value: "1", label: <span className="truncate">{teams.home}</span>, title: teams.home },
              { value: "2", label: <span className="truncate">{teams.away}</span>, title: teams.away },
            ]}
          />
        }
        presets={presetsMenu}
        players={players}
        labels={labels}
        periods={periods}
        moments={{ counts: momentCounts, why }}
        playerExtra={
          onePlayerName && (
            <label className="flex items-center justify-between gap-3 rounded-md bg-fill-1 px-2.5 py-2 text-callout">
              <span>
                While on the floor
                <span className="block text-subheadline text-muted-foreground">Every play while {onePlayerName} is in the game.</span>
              </span>
              <Switch checked={filters.onCourt} onCheckedChange={(on) => onChange({ ...filters, onCourt: on })} />
            </label>
          )
        }
        open={sheetOpen}
        onOpenChange={onSheetOpenChange}
        searchRef={searchRef}
        picks={
          filters.picked && (
            // The plays behind a number in Stats: a token of their own, cleared on its own; the rest of the filters stay.
            <FilterToken
              name="Stats"
              values={filters.picked.name}
              removeLabel={`Clear ${filters.picked.name}`}
              onRemove={() => onChange({ ...filters, picked: null })}
            />
          )
        }
        onClearAll={() => onChange({ ...EMPTY_GAME_FILTERS, team: filters.team, play: { ...EMPTY_GAME_FILTERS.play, types: play.types } })}
      />
      {/* How many plays are listed, always; Clear filters and Add all while filters narrow them (PlaysCountLine). */}
      <PlaysCountLine
        className="h-7"
        count={visible}
        total={total}
        filtered={filtered}
        onClear={() => onChange(EMPTY_GAME_FILTERS)}
        trail={
          filtered &&
          visible > 0 && (
            <Button
              variant="outline"
              size="xs"
              disabled={addable === 0}
              onClick={(e) => onAddAll(e.currentTarget)}
              title={addable === 0 ? `All ${visible} are in ${targetName ?? "the playlist"}` : undefined}
            >
              {addable === 0 ? <Check /> : <Plus />}
              {addable === 0 ? "All added" : addable === visible ? `Add all ${visible}` : `Add the other ${addable}`}
            </Button>
          )
        }
      />
    </div>
  );
}

