import { memo, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { Label } from "@scoutable/shared/types/labels";
import { eventLabel, playClock, playerName } from "@scoutable/shared/lib/events";
import type { TeamGame, TeamPlayRow } from "@scoutable/shared/lib/team-video";
import { LabelChip } from "@/components/labels/LabelChip";
import { useListWindow } from "@/lib/use-list-window";
import { cn } from "@/lib/utils";
import { playedDay } from "./dates";

/** Every row of the list is this tall: the window draws only the rows near the view. */
export const PLAY_ROW_HEIGHT = 32;

/** How a row was clicked: ⌘ (Ctrl) toggles it into the selection, Shift selects the range to it. */
export interface RowClick {
  toggle: boolean;
  range: boolean;
}

/** A list row: the Plays rows, plus a note under a game whose plays can't play here. */
export type ListRow = TeamPlayRow | { kind: "note"; game: TeamGame; why: "video" | "sync" };

/** "vs Beta · 15 Nov · W 78–71". */
export function gameTitle(g: TeamGame): string {
  const result = g.result && g.score ? ` · ${g.result} ${g.score.own}–${g.score.opp}` : "";
  return `${g.home ? "vs" : "at"} ${g.opponentName} · ${playedDay(g.at)}${result}`;
}

function GameHeader({ game, plays, pinned = false }: { game: TeamGame; plays: number; pinned?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline gap-2 border-b border-separator bg-background px-4 pt-2.5 pb-1.5",
        pinned && "absolute inset-x-0 top-0 z-10",
      )}
      style={{ height: PLAY_ROW_HEIGHT }}
      aria-hidden={pinned || undefined}
    >
      <span className="truncate text-headline text-foreground">{gameTitle(game)}</span>
      <span className="ml-auto shrink-0 text-subheadline text-muted-foreground nums">
        {plays} {plays === 1 ? "play" : "plays"}
      </span>
    </div>
  );
}

const PlayRow = memo(function PlayRow({
  row,
  lit,
  selected,
  dim,
  labels,
  onPlay,
}: {
  row: Extract<TeamPlayRow, { kind: "play" }>;
  lit: boolean;
  selected: boolean;
  dim: boolean;
  labels: readonly Label[] | undefined;
  onPlay: (key: string, how: RowClick) => void;
}) {
  const e = row.event;
  const who = e.player ? `${e.player.pno ? `#${e.player.pno} ` : ""}${playerName(e)}` : (e.eventTeam?.teamName ?? "");
  return (
    <button
      type="button"
      data-key={row.key}
      aria-current={lit || undefined}
      aria-pressed={selected}
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={(ev) => onPlay(row.key, { toggle: ev.metaKey || ev.ctrlKey, range: ev.shiftKey })}
      className={cn(
        "relative flex w-full items-center gap-3 px-4 text-left text-sm outline-none transition-colors duration-100 hover:bg-fill-1 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-inset",
        selected && "bg-row-selected hover:bg-row-selected",
        lit && "font-medium",
        dim && "opacity-55",
      )}
      style={{ height: PLAY_ROW_HEIGHT }}
    >
      {/* The play on screen: a bar at the row's edge, apart from the selection's fill. */}
      {lit && <span aria-hidden className="absolute inset-y-1.5 left-1 w-[3px] rounded-full bg-foreground" />}
      <span className="w-16 shrink-0 text-muted-foreground nums">{playClock(e)}</span>
      <span className="min-w-0 flex-1 truncate">{who}</span>
      {labels && labels.length > 0 && (
        <span className="flex shrink-0 gap-1">
          {labels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} label={l} className="px-1.5 text-[10px]" />
          ))}
        </span>
      )}
      <span className="shrink-0 text-muted-foreground">{eventLabel(e)}</span>
    </button>
  );
});

/**
 * The Plays list across games: a header per game, the game's plays under it,
 * and a note under a game whose plays can't play here. Windowed: a team's
 * games can hold thousands of plays. The top row's game stays pinned above the
 * list, as a sticky header would (the window's rows can't be sticky).
 */
export function TeamPlayList({
  rows,
  current,
  selected,
  playable,
  labelsByKey,
  onPlay,
}: {
  rows: readonly ListRow[];
  current: string | null;
  selected: ReadonlySet<string>;
  playable: (gameId: string) => "ok" | "video" | "sync";
  labelsByKey: ReadonlyMap<string, Label[]>;
  onPlay: (key: string, how: RowClick) => void;
}) {
  const { scrollRef, range, reveal } = useListWindow({ count: rows.length, rowHeight: PLAY_ROW_HEIGHT });
  const indexByKey = useMemo(() => new Map(rows.flatMap((r, i) => (r.kind === "play" ? [[r.key, i] as const] : []))), [rows]);
  // The play on screen stays in view as it changes (a run on into the next game, ↑ ↓).
  useEffect(() => {
    if (current) reveal(indexByKey.get(current));
  }, [current, indexByKey, reveal]);

  // The game the top drawn row belongs to, pinned once its own header has scrolled away.
  const topIndex = Math.min(rows.length - 1, Math.max(0, Math.floor((scrollRef.current?.scrollTop ?? 0) / PLAY_ROW_HEIGHT)));
  let pinned: { game: TeamGame; plays: number } | null = null;
  if ((scrollRef.current?.scrollTop ?? 0) > 0) {
    for (let i = topIndex; i >= 0; i--) {
      const r = rows[i];
      if (r?.kind === "game") {
        pinned = { game: r.game, plays: r.plays };
        break;
      }
    }
  }

  return (
    <div className="relative min-h-0 flex-1">
      {pinned && <GameHeader game={pinned.game} plays={pinned.plays} pinned />}
      <div ref={scrollRef} className="h-full overflow-y-auto" role="list" aria-label="Plays">
        <div style={{ height: range.padTop }} />
        {rows.slice(range.start, range.end).map((r) =>
          r.kind === "game" ? (
            <div key={`g:${r.game.gameId}`} role="listitem">
              <GameHeader game={r.game} plays={r.plays} />
            </div>
          ) : r.kind === "note" ? (
            <p key={`n:${r.game.gameId}`} className="flex items-center gap-1 truncate px-4 text-subheadline text-muted-foreground" style={{ height: PLAY_ROW_HEIGHT }}>
              {r.why === "video" ? "This game's video isn't on this computer." : "This game isn't synced yet."}
              <Link to={`/matches/${r.game.gameId}?view=details`} className="rounded text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection">
                {r.why === "video" ? "Locate video" : "Set the tip-off"}
              </Link>
            </p>
          ) : (
            <div key={r.key} role="listitem">
              <PlayRow
                row={r}
                lit={r.key === current}
                selected={selected.has(r.key)}
                dim={playable(r.game.gameId) !== "ok"}
                labels={labelsByKey.get(r.key)}
                onPlay={onPlay}
              />
            </div>
          ),
        )}
        <div style={{ height: range.padBottom }} />
      </div>
    </div>
  );
}
