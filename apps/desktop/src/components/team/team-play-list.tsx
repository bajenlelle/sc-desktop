import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Label } from "@scoutable/shared/types/labels";
import type { TeamGame, TeamPlayRow } from "@scoutable/shared/lib/team-video";
import type { CollectStatus } from "@/components/game/game-play-row";
import { ActiveRowPill, LIST_GROUP, listSelecting, PLAY_ROW_HEIGHT, PlayRowCells, playRowClass, RowLabelButton, RowPlaylistSlot, RowTip } from "@/components/plays/play-row";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { pressable } from "@/lib/pressable";
import { useListWindow } from "@/lib/use-list-window";
import { useScrollMemory } from "@/lib/page-memory";
import { cn } from "@/lib/utils";
import { playedDay } from "./dates";

export { PLAY_ROW_HEIGHT };

const NO_LABELS: readonly Label[] = [];

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
  status,
  targetName,
  menuOpen,
  labelPicker,
  onPlay,
  onAdd,
  onRemove,
  onLabel,
}: {
  row: Extract<TeamPlayRow, { kind: "play" }>;
  lit: boolean;
  selected: boolean;
  dim: boolean;
  labels: readonly Label[] | undefined;
  status: CollectStatus;
  targetName: string | null;
  /** The list's menu is open on this play. */
  menuOpen: boolean;
  /** The label picker, on the one row being labelled; the plain tag button otherwise. */
  labelPicker: ReactNode | null;
  onPlay: (key: string, how: RowClick) => void;
  onAdd: (key: string, anchor: HTMLElement) => void;
  onRemove: (key: string) => void;
  onLabel: (key: string) => void;
}) {
  return (
    <div
      {...pressable(() => onPlay(row.key, { toggle: false, range: false }), { space: false })}
      onClick={(ev) => onPlay(row.key, { toggle: ev.metaKey || ev.ctrlKey, range: ev.shiftKey })}
      // The row's label picker is a portal, and its events bubble here through React: a press in its field places
      // the caret, and a right-click there keeps the system's Cut, Copy and Paste rather than the list's menu.
      onMouseDown={(ev) => {
        if (ev.currentTarget.contains(ev.target as Node)) ev.preventDefault();
      }}
      onContextMenu={(ev) => {
        if (!ev.currentTarget.contains(ev.target as Node)) ev.stopPropagation();
      }}
      data-key={row.key}
      aria-current={lit || undefined}
      aria-pressed={selected}
      className={playRowClass({ selected, menuOpen })}
    >
      {lit && !selected && <ActiveRowPill />}
      <PlayRowCells
        event={row.event}
        clock="with-period"
        now={lit}
        strong={lit}
        team={null}
        labels={labels ?? NO_LABELS}
        dim={dim}
        check={{ on: selected, onToggle: (shift) => onPlay(row.key, { toggle: !shift, range: shift }) }}
        actions={
          <>
            {labelPicker ?? (
              <RowTip label="Label" keyHint="G">
                <RowLabelButton visible={lit} onClick={() => onLabel(row.key)} />
              </RowTip>
            )}
            <RowPlaylistSlot
              status={status}
              targetName={targetName}
              visible={lit}
              onAdd={(anchor) => onAdd(row.key, anchor)}
              onRemove={() => onRemove(row.key)}
            />
          </>
        }
      />
    </div>
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
  statusOf,
  targetName,
  labelPickerFor,
  renderLabelPicker,
  rowMenu,
  onPlay,
  onAdd,
  onRemove,
  onLabel,
  selectionBar,
}: {
  rows: readonly ListRow[];
  current: string | null;
  selected: ReadonlySet<string>;
  playable: (gameId: string) => "ok" | "video" | "sync";
  labelsByKey: ReadonlyMap<string, Label[]>;
  statusOf: (key: string) => CollectStatus;
  targetName: string | null;
  /** The play whose label picker is open, by key. */
  labelPickerFor: string | null;
  renderLabelPicker: (key: string) => ReactNode;
  /** A play's menu (right-click), as `ContextMenuContent`; `anchor` is its row. */
  rowMenu: (key: string, anchor: HTMLElement) => ReactNode;
  onPlay: (key: string, how: RowClick) => void;
  onAdd: (key: string, anchor: HTMLElement) => void;
  onRemove: (key: string) => void;
  onLabel: (key: string) => void;
  /** The selection's pill (PlaysSelectionBar), over the bottom of the list while plays are selected. */
  selectionBar?: ReactNode;
}) {
  /** The play the menu is open on, and its row: one menu for the whole list, as the game view's. */
  const [menuFor, setMenuFor] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const { scrollRef, range, reveal } = useListWindow({ count: rows.length, rowHeight: PLAY_ROW_HEIGHT });
  // Back to these plays comes back to where the list was scrolled.
  useScrollMemory(scrollRef, "team-plays-list");
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
      <ContextMenu onOpenChange={(open) => !open && setMenuFor(null)}>
        <ContextMenuTrigger asChild>
      <div
        ref={scrollRef}
        // Room under the last play for the selection's pill, so it never covers one.
        className={cn(LIST_GROUP, "h-full overflow-y-auto", selected.size > 0 && "pb-16")}
        role="list"
        aria-label="Plays"
        {...listSelecting(selected.size > 0)}
        // A right-click on a play opens its menu; on a header, a note or empty space none opens.
        onContextMenu={(e) => {
          const el = (e.target as Element).closest<HTMLElement>("[data-key]");
          if (!el || !el.dataset.key) {
            e.preventDefault();
            return;
          }
          setMenuFor({ key: el.dataset.key, anchor: el });
        }}
      >
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
                status={statusOf(r.key)}
                targetName={targetName}
                menuOpen={menuFor?.key === r.key}
                labelPicker={labelPickerFor === r.key ? renderLabelPicker(r.key) : null}
                onPlay={onPlay}
                onAdd={onAdd}
                onRemove={onRemove}
                onLabel={onLabel}
              />
            </div>
          ),
        )}
        <div style={{ height: range.padBottom }} />
      </div>
        </ContextMenuTrigger>
        {menuFor && rowMenu(menuFor.key, menuFor.anchor)}
      </ContextMenu>
      {/* The pill's own container (SelectionBar sizes its labels by it): on the list's parent, a container query
          makes WebKit throw a windowed list's scroll back when its rows are redrawn. */}
      {selectionBar && <div className="pointer-events-none absolute inset-x-0 bottom-0 @container">{selectionBar}</div>}
    </div>
  );
}
