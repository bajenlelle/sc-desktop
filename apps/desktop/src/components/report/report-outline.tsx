import { useRef, type KeyboardEvent } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useListDrag } from "@/components/editor/use-list-drag";
import { cn } from "@/lib/utils";
import { TEAM_SECTION, type Placement } from "@scoutable/shared/lib/report-draft";

export interface OutlineRow {
  id: Placement;
  /** "Alva Berg", or "Team". */
  label: string;
  number: string | null;
  clips: number;
  statsLoading: boolean;
}

/**
 * The report's table of contents: the Team row, then a row per player in
 * report order. A click (or Return) scrolls the document to the section;
 * dragging a player's row, ⌥↑/⌥↓, or the row's menu reorders the report, and
 * the Team row stays first. ⌫ or the row's ✕ removes a player.
 *
 * The row itself is the click and drag target: the drag engine ignores a
 * press that starts on a button, so only the ✕ is one.
 */
export function ReportOutline({
  rows,
  activeId,
  reducedMotion,
  onSelect,
  onMove,
  onRemove,
  onAddPlayers,
}: {
  rows: OutlineRow[];
  activeId: Placement | null;
  reducedMotion: boolean;
  onSelect: (id: Placement) => void;
  /** `toIndex` counts player sections only (the Team row is not one). */
  onMove: (id: string, toIndex: number) => void;
  onRemove: (id: string) => void;
  onAddPlayers: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const noSidebar = useRef<HTMLElement | null>(null);
  const teamShown = rows[0]?.id === TEAM_SECTION;
  const firstPlayerRow = teamShown ? 1 : 0;

  const drag = useListDrag({
    listRef,
    sidebarRef: noSidebar,
    reducedMotion,
    canStart: (key) => key !== TEAM_SECTION,
    blockFor: (key) => [key],
    // The Team row stays first.
    snapGap: (gap) => Math.max(firstPlayerRow, gap),
    onTarget: () => {},
    onDrop: ({ gap, anchorKey }) => {
      const from = rows.findIndex((r) => r.id === anchorKey);
      if (from < 0) return;
      const display = gap > from ? gap - 1 : gap;
      onMove(anchorKey, display - firstPlayerRow);
    },
    onDropOnPlaylist: () => {},
    onEnd: () => {},
  });

  const playerIndex = (id: Placement) => rows.findIndex((r) => r.id === id) - firstPlayerRow;
  const focusRow = (id: Placement | undefined) => {
    if (id === undefined) return;
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(id)}"]`)?.focus());
  };
  // One row is in the tab order: the active one, else the first.
  const tabStop = rows.some((r) => r.id === activeId) ? activeId : rows[0]?.id;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[data-row-key]")?.dataset.rowKey;
    if (!id) return;
    const at = rows.findIndex((r) => r.id === id);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
      if (e.altKey) {
        if (id !== TEAM_SECTION && next >= firstPlayerRow) onMove(id, next - firstPlayerRow);
        focusRow(id);
      } else focusRow(rows[next]?.id);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && id !== TEAM_SECTION) {
      e.preventDefault();
      // The row that takes its place, else the one above.
      const next = rows[at + 1]?.id ?? rows[at - 1]?.id;
      onRemove(id);
      focusRow(next);
    }
  }

  return (
    <nav aria-label="Report outline" className="flex h-full w-[260px] shrink-0 flex-col border-r border-separator">
      <div ref={listRef} role="listbox" aria-label="Sections" onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {rows.length === 0 && <p className="px-2 py-3 text-callout text-muted-foreground">No players yet.</p>}
        {rows.map((row) => {
          const isTeam = row.id === TEAM_SECTION;
          const active = row.id === activeId;
          const index = playerIndex(row.id);
          const last = index === rows.length - 1 - firstPlayerRow;
          return (
            <ContextMenu key={row.id}>
              <ContextMenuTrigger asChild>
                <div
                  data-row-key={row.id}
                  role="option"
                  aria-selected={active}
                  tabIndex={row.id === tabStop ? 0 : -1}
                  onPointerDown={(e) => drag.onRowPointerDown(e, row.id)}
                  onClick={() => onSelect(row.id)}
                  className={cn(
                    "group relative flex h-8 items-center gap-2 rounded-md pr-1 pl-1 text-sm text-foreground outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-selection",
                    active ? "bg-fill-2" : "hover:bg-fill-1",
                    !isTeam && "cursor-grab active:cursor-grabbing",
                  )}
                >
                  <span className="w-7 shrink-0 text-right text-caption text-muted-foreground nums">{!isTeam && row.number ? `#${row.number}` : ""}</span>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.statsLoading ? (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Reading the stats" />
                  ) : (
                    <span className={cn("shrink-0 px-1 text-caption text-muted-foreground nums", !isTeam && "group-hover:hidden group-focus-within:hidden")}>{row.clips}</span>
                  )}
                  {!isTeam && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Remove ${row.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const at = rows.findIndex((r) => r.id === row.id);
                        onRemove(row.id);
                        if (listRef.current?.contains(document.activeElement)) focusRow(rows[at + 1]?.id ?? rows[at - 1]?.id);
                      }}
                      className="hidden size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-fill-3 hover:text-foreground group-hover:flex group-focus-within:flex"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              {!isTeam && (
                <ContextMenuContent>
                  <ContextMenuItem disabled={index <= 0} onSelect={() => onMove(row.id, index - 1)}>
                    Move up
                  </ContextMenuItem>
                  <ContextMenuItem disabled={last} onSelect={() => onMove(row.id, index + 1)}>
                    Move down
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => onRemove(row.id)}>
                    Remove from report
                  </ContextMenuItem>
                </ContextMenuContent>
              )}
            </ContextMenu>
          );
        })}
      </div>
      <div className="border-t border-separator p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddPlayers}>
          <Plus />
          Add players
        </Button>
      </div>
    </nav>
  );
}
