import * as React from "react";
import type { PlaylistGame } from "@scoutable/shared/lib/playlist-games";
import {
  ArrowDownUp,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  CircleX,
  Columns2,
  FileDown,
  Filter,
  Loader2,
  Lock,
  MoreHorizontal,
  Play,
  Plus,
  Rows2,
  Share2,
  Smartphone,
  Square,
  Timer,
  Trash2,
  Type,
} from "lucide-react";
import { exportProgressLabel, exportProgressPercent, type ExportProgress } from "@scoutable/shared/lib/export-progress";
import type { ExportAction } from "@/components/export-format-dialog";
import { Toolbar, ToolbarAction } from "@/components/shell/toolbar";
import { PlaylistViewSwitch } from "@/components/editor/playlist-view-switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Kbd } from "@/components/ui/kbd";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Stepper } from "@/components/ui/stepper";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type ClockSort = "none" | "asc" | "desc";

/** The game the coach came from, when they came from one: "‹ {title}" leads the toolbar and takes them back. */
export interface BackToGame {
  title: string;
  onBack: () => void;
}

/** The toolbar's leading back button, the one the game page uses for "‹ Library". */
export function BackButton({ title, onBack }: BackToGame) {
  return (
    <Button variant="ghost" size="sm" className="-ml-1 min-w-0 shrink text-muted-foreground" onClick={onBack}>
      <ChevronLeft className="shrink-0" />
      <span className="max-w-48 truncate">{title}</span>
    </Button>
  );
}

/** A reference in running text: quiet until pointed at, then the link it is. */
const REFERENCE =
  "cursor-pointer rounded-sm underline-offset-2 outline-none transition-colors duration-100 hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:text-primary";

/**
 * The playlist's games, in its subtitle: one game is named, a link that opens it; several are counted
 * ("3 games"), and the count opens a menu of them with their clips. A reference, not a button: the subtitle
 * reads as it did, and the game is a click away.
 */
function GamesReference({ games, onOpen }: { games: PlaylistGame[]; onOpen: (matchId: string, via: "subtitle" | "subtitle_menu") => void }) {
  if (games.length === 1) {
    const [game] = games;
    return (
      <a
        href={`/matches/${game.id}`}
        // Takes the room after the title up to its own length, and keeps a few letters to click when there is
        // less: the title gives way after that (components/shell/toolbar.tsx).
        className={cn(REFERENCE, "block w-0 min-w-[3rem] max-w-max grow truncate")}
        title={`Open ${game.title}`}
        onClick={(e) => {
          // The playlist opens it: it notes the way back and where Add collects to.
          e.preventDefault();
          onOpen(game.id, "subtitle");
        }}
      >
        {game.title}
      </a>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <span role="button" tabIndex={0} className={cn(REFERENCE, "shrink-0")}>
          {games.length} games
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        {games.map((game) => (
          <DropdownMenuItem key={game.id} onSelect={() => onOpen(game.id, "subtitle_menu")}>
            <span className="min-w-0 flex-1 truncate">{game.title}</span>
            <span className="shrink-0 pl-3 text-xs nums text-muted-foreground">
              {game.clips} clip{game.clips !== 1 ? "s" : ""}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface EditorToolbarProps {
  name: string;
  /** Set while the editor was opened from a game page. */
  backTo?: BackToGame | null;
  itemCount: number;
  /** The games the playlist's clips come from (packages/shared/lib/playlist-games.ts), named in the subtitle. */
  games: PlaylistGame[];
  /** Opens a game (its toolbar's back button returns to this playlist). */
  onOpenGame: (matchId: string, via: "subtitle" | "subtitle_menu") => void;
  editing: boolean;
  editValue: string;
  onEditValueChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onDeletePlaylist: () => void;

  theaterMode: boolean;
  onTheaterModeChange: (theater: boolean) => void;

  isPlaying: boolean;
  playDisabled: boolean;
  playLabel: string;
  onPlay: () => void;
  onStop: () => void;

  onAddClips: () => void;
  highlightAddClips: boolean;

  filtersOpen: boolean;
  filtersActive: boolean;
  activeFilterDims: number;
  onToggleFilters: () => void;

  onAddTextCard: () => void;
  addTextCardDisabledReason: string | null;
  onAddStatsCard: () => void;
  addStatsCardDisabledReason: string | null;

  preRoll: number;
  postRoll: number;
  onPreRollChange: (seconds: number) => void;
  onPostRollChange: (seconds: number) => void;

  clockSort: ClockSort;
  clockSortLocked: boolean;
  onClockSortChange: (sort: ClockSort) => void;

  hasItems: boolean;
  onSelectAll: () => void;

  exportLocked: boolean;
  /** Tooltip on the locked Export button; defaults to the Pro line. */
  exportLockedTitle?: string;
  exportDisabledReason: string | null;
  isExporting: boolean;
  exportProgress: ExportProgress | null;
  /** Stops the running Save to computer render. */
  onStopExport: () => void;
  exportLabel: string;
  highlightExport: boolean;
  onExport: (action: ExportAction) => void;
  onExportMenuOpen: () => void;

  /** Switches to the playlist's scouting report (the view switch beside the title). */
  onOpenReport: () => void;
  /** "Shared · expires 19 Nov 2026" while the playlist has a live report. */
  reportStatus: string | null;

  shareVisible: boolean;
  isShipping: boolean;
  shipLabel: string | null;
  isShared: boolean;
  sharedLabel: string;
  shareDisabledReason: string | null;
  highlightShare: boolean;
  onShare: () => void;
}

/** A disabled button still explains itself: the tooltip wraps a span. */
function Explained({ reason, children }: { reason: string | null; children: React.ReactElement }) {
  if (!reason) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">{reason}</TooltipContent>
    </Tooltip>
  );
}

const highlightRing = "ring-2 ring-selection ring-offset-2 ring-offset-background animate-pulse";

/** A menu item that, when it can't be used, says why underneath. */
function CardMenuItem({
  icon,
  label,
  reason,
  onSelect,
}: {
  icon: React.ReactElement;
  label: string;
  reason: string | null;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} disabled={!!reason} className="items-start">
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex flex-col">
        <span>{label}</span>
        {reason && <span className="text-caption text-muted-foreground">{reason}</span>}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The editor's toolbar: the playlist's name (click to rename), its size,
 * then the actions a coach reaches for every session. Settings that are
 * set once (clip length, sort) sit one level deeper; cards are added from
 * the menu beside Add clips, everything that goes into the video in one place.
 */
export function EditorToolbar(p: EditorToolbarProps) {
  const title = p.editing ? (
    <input
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      value={p.editValue}
      aria-label="Playlist name"
      onChange={(e) => p.onEditValueChange(e.target.value)}
      onBlur={p.onCommitRename}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") p.onCancelRename();
      }}
      className="h-7 min-w-40 rounded-md bg-card px-2 text-title-3 text-foreground ring-2 ring-selection outline-none"
    />
  ) : (
    <button
      type="button"
      onClick={p.onStartRename}
      title="Rename playlist"
      className="max-w-full truncate rounded-md px-1 text-left text-title-3 text-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
    >
      {p.name}
    </button>
  );

  // Parts the toolbar lays out side by side: the count stays whole, the game's name is cut short by itself and
  // keeps enough of itself to be read and clicked (components/shell/toolbar.tsx).
  const subtitle = (
    <>
      <span className="shrink-0 whitespace-pre">
        {p.itemCount} item{p.itemCount !== 1 ? "s" : ""}
        {p.games.length > 0 ? " · " : ""}
      </span>
      {p.games.length > 0 && <GamesReference games={p.games} onOpen={p.onOpenGame} />}
    </>
  );

  return (
    <Toolbar
      variant="static"
      leading={
        <>
          {p.backTo && <BackButton {...p.backTo} />}
          <PlaylistViewSwitch value="clips" onChange={(v) => v === "report" && p.onOpenReport()} sharedStatus={p.reportStatus} />
        </>
      }
      title={title}
      subtitle={subtitle}
      // Below this the actions show their icons only, so the title and the game keep their room. Measured on the
      // bar itself: the labels take some 180 px, and a back button to a game needs room of its own.
      compactBelow={p.backTo ? 1240 : 1100}
      actions={
        <>
          {/* Clip length: pre/post roll, set once per playlist. */}
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Clip length">
                    <Timer />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clip length: {p.preRoll} s before, {p.postRoll} s after</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-64 space-y-3">
              <div>
                <p className="text-headline">Clip length</p>
                <p className="mt-0.5 text-callout text-muted-foreground">Seconds of footage before and after each play.</p>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Before</span>
                <Stepper label="Pre-roll" value={p.preRoll} min={0} max={30} onChange={p.onPreRollChange} format={(v) => `${v} s`} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">After</span>
                <Stepper label="Post-roll" value={p.postRoll} min={0} max={60} onChange={p.onPostRollChange} format={(v) => `${v} s`} />
              </div>
            </PopoverContent>
          </Popover>

          <ToolbarAction label="Filter">
            {(compact) => (
              <Button
                variant={p.filtersActive ? "secondary" : "ghost"}
                size={compact && p.activeFilterDims === 0 ? "icon-sm" : "sm"}
                onClick={p.onToggleFilters}
                aria-pressed={p.filtersOpen}
                aria-label={compact ? "Filter" : undefined}
                title={compact ? undefined : "Filter clips by player, label, event type, period or game"}
              >
                <Filter />
                {!compact && "Filter"}
                {p.activeFilterDims > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-caption nums text-primary-foreground">{p.activeFilterDims}</span>
                )}
              </Button>
            )}
          </ToolbarAction>

          {p.isPlaying ? (
            <ToolbarAction label="Stop">
              {(compact) => (
                <Button variant="outline" size={compact ? "icon-sm" : "sm"} onClick={p.onStop} aria-label={compact ? "Stop" : undefined}>
                  <Square className="fill-current" />
                  {!compact && "Stop"}
                </Button>
              )}
            </ToolbarAction>
          ) : (
            <ToolbarAction label={p.playLabel}>
              {(compact) => (
                <Button
                  variant="outline"
                  size={compact ? "icon-sm" : "sm"}
                  onClick={p.onPlay}
                  disabled={p.playDisabled}
                  aria-label={compact ? p.playLabel : undefined}
                >
                  <Play className="fill-current" />
                  {!compact && p.playLabel}
                </Button>
              )}
            </ToolbarAction>
          )}

          <div className={cn("flex items-center rounded-md", p.highlightAddClips && highlightRing)}>
            <ToolbarAction label="Add clips">
              {(compact) => (
                <Button
                  size={compact ? "icon-sm" : "sm"}
                  className="rounded-r-none"
                  onClick={p.onAddClips}
                  aria-label={compact ? "Add clips" : undefined}
                >
                  <Plus />
                  {!compact && "Add clips"}
                </Button>
              )}
            </ToolbarAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-l-none border-l border-primary-foreground/25 px-1.5"
                  aria-label="Add a card"
                  title="Add a text or stats card"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <CardMenuItem icon={<Type />} label="Add text card" reason={p.addTextCardDisabledReason} onSelect={p.onAddTextCard} />
                <CardMenuItem icon={<BarChart3 />} label="Add stats card" reason={p.addStatsCardDisabledReason} onSelect={p.onAddStatsCard} />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {p.isExporting ? (
            // Progress with its own stop control, like a download in Safari.
            <div className="flex h-8 items-center gap-2 rounded-md bg-fill-2 pr-1 pl-2.5 text-sm">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="nums">{p.exportProgress ? exportProgressLabel(p.exportProgress) : "Exporting…"}</span>
              {p.exportProgress && <ProgressBar percent={exportProgressPercent(p.exportProgress)} className="w-16" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Stop exporting"
                    onClick={p.onStopExport}
                    className="flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-fill-2 hover:text-foreground active:scale-90 focus-visible:ring-2 focus-visible:ring-selection"
                  >
                    <CircleX className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Stop exporting <Kbd className="ml-1">⌘.</Kbd>
                </TooltipContent>
              </Tooltip>
            </div>
          ) : (
            <Explained reason={p.exportLocked ? null : p.exportDisabledReason}>
              <DropdownMenu onOpenChange={(open) => open && p.onExportMenuOpen()}>
                <ToolbarAction label={p.exportLabel}>
                  {(compact) => (
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(p.highlightExport && highlightRing)}
                        disabled={p.exportLocked ? !p.hasItems : !!p.exportDisabledReason}
                        aria-label={compact ? p.exportLabel : undefined}
                        title={p.exportLocked ? (p.exportLockedTitle ?? "Export playlists as MP4 with Pro") : undefined}
                      >
                        {p.exportLocked ? <Lock /> : <FileDown />}
                        {!compact && p.exportLabel}
                        <ChevronDown className="size-3 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                  )}
                </ToolbarAction>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuItem onSelect={() => p.onExport("save")}>
                    <FileDown className="text-muted-foreground" />
                    Save to computer…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => p.onExport("send")}>
                    <Smartphone className="text-muted-foreground" />
                    Send to my phone…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Explained>
          )}

          {p.shareVisible &&
            (p.isShipping ? (
              <Button size="sm" variant="outline" disabled>
                <Loader2 className="animate-spin" />
                <span className="nums">{p.shipLabel ?? "Uploading…"}</span>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      size="icon-sm"
                      variant={p.isShared ? "default" : "outline"}
                      className={cn(p.highlightShare && highlightRing)}
                      onClick={p.onShare}
                      disabled={!!p.shareDisabledReason}
                      aria-label="Share"
                    >
                      <Share2 />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-64">
                  {p.isShared ? `Shared with: ${p.sharedLabel}` : (p.shareDisabledReason ?? "Share with your team or members")}
                </TooltipContent>
              </Tooltip>
            ))}

          <SegmentedControl
            aria-label="Layout"
            value={p.theaterMode ? "theater" : "split"}
            onValueChange={(v) => p.onTheaterModeChange(v === "theater")}
            options={[
              { value: "split", label: <Columns2 />, title: "Split view" },
              { value: "theater", label: <Rows2 />, title: "Theater" },
            ]}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={p.clockSortLocked}>
                  <ArrowDownUp className="text-muted-foreground" />
                  Sort by clock
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={p.clockSort} onValueChange={(v) => p.onClockSortChange(v as ClockSort)}>
                    <DropdownMenuRadioItem value="none">Playlist order</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="asc">Earliest first</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="desc">Latest first</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={p.onSelectAll} disabled={!p.hasItems}>
                Select all
                <span className="ml-auto text-xs text-muted-foreground">⌘A</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={p.onStartRename}>Rename…</DropdownMenuItem>
              <DropdownMenuItem onSelect={p.onDeletePlaylist} className="text-destructive focus:bg-destructive/10 focus:text-destructive">
                <Trash2 />
                Delete playlist…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    />
  );
}
