import * as React from "react";
import {
  ArrowDownUp,
  ChevronDown,
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
import { Toolbar } from "@/components/shell/toolbar";
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

export interface EditorToolbarProps {
  name: string;
  itemCount: number;
  isMultiMatch: boolean;
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
  exportDisabledReason: string | null;
  isExporting: boolean;
  exportProgress: ExportProgress | null;
  /** Stops the running Save to computer render. */
  onStopExport: () => void;
  exportLabel: string;
  highlightExport: boolean;
  onExport: (action: ExportAction) => void;
  onExportMenuOpen: () => void;

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

/**
 * The editor's toolbar: the playlist's name (click to rename), its size,
 * then the actions a coach reaches for every session. Settings that are
 * set once (clip length, sort, text cards) sit one level deeper.
 */
export function EditorToolbar(p: EditorToolbarProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const title = p.editing ? (
    <input
      ref={inputRef}
      autoFocus
      value={p.editValue}
      aria-label="Playlist name"
      onChange={(e) => p.onEditValueChange(e.target.value)}
      onBlur={p.onCommitRename}
      onKeyDown={(e) => {
        if (e.key === "Enter") p.onCommitRename();
        if (e.key === "Escape") p.onCancelRename();
      }}
      className="h-7 min-w-40 rounded-md bg-card px-2 text-title-3 text-foreground ring-2 ring-selection outline-none"
    />
  ) : (
    <button
      type="button"
      onClick={p.onStartRename}
      title="Rename playlist"
      className="max-w-[32rem] truncate rounded-md px-1 text-left text-title-3 text-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
    >
      {p.name}
    </button>
  );

  const subtitle = `${p.itemCount} item${p.itemCount !== 1 ? "s" : ""}${p.isMultiMatch ? " · multiple games" : ""}`;

  return (
    <Toolbar
      variant="static"
      title={title}
      subtitle={subtitle}
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

          <Button
            variant={p.filtersActive ? "secondary" : "ghost"}
            size="sm"
            onClick={p.onToggleFilters}
            aria-pressed={p.filtersOpen}
            title="Filter clips by player, label, event type, period or game"
          >
            <Filter />
            Filter
            {p.activeFilterDims > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-caption nums text-primary-foreground">{p.activeFilterDims}</span>
            )}
          </Button>

          {p.isPlaying ? (
            <Button variant="outline" size="sm" onClick={p.onStop}>
              <Square className="fill-current" />
              Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={p.onPlay} disabled={p.playDisabled}>
              <Play className="fill-current" />
              {p.playLabel}
            </Button>
          )}

          <Button size="sm" className={cn(p.highlightAddClips && highlightRing)} onClick={p.onAddClips}>
            <Plus />
            Add clips
          </Button>

          {p.isExporting ? (
            // Progress with its own stop control, like a download in Safari.
            <div className="flex h-8 items-center gap-2 rounded-md bg-card pr-1 pl-2.5 text-sm shadow-xs ring-1 ring-separator">
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
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(p.highlightExport && highlightRing)}
                    disabled={p.exportLocked ? !p.hasItems : !!p.exportDisabledReason}
                    title={p.exportLocked ? "Export playlists as MP4 with Rookie or Pro" : undefined}
                  >
                    {p.exportLocked ? <Lock /> : <FileDown />}
                    {p.exportLabel}
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
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
              <DropdownMenuItem onSelect={p.onAddTextCard} disabled={!!p.addTextCardDisabledReason}>
                <Type className="text-muted-foreground" />
                Add text card
              </DropdownMenuItem>
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
              <DropdownMenuItem onSelect={p.onDeletePlaylist} className="text-destructive focus:bg-destructive focus:text-white">
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
