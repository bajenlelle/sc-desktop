import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Columns2,
  FileDown,
  FolderPlus,
  Lock,
  Share2,
  Users,
  User2,
  GripVertical,
  ListPlus,
  ListVideo,
  MessageSquare,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Rows2,
  Search,
  SkipForward,
  Square,
  Tag,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelectDropdown, SingleSelectDropdown } from "@/components/ui/multi-select-dropdown";
import { VideoPlayer } from "@/components/video-player";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { usePanelRef } from "react-resizable-panels";
import { VideoClipControls } from "@/components/video-clip-controls";
import { listMatchesLight, listEventsForMatches, listFolders, createFolder, updateFolder, deleteFolder } from "@/lib/matches-db";
import { listPlaylists, createPlaylist, updatePlaylist, deletePlaylist, addClips, removeClips, reorderItems, updateClip, insertTextCard, updateTextCard, setPlaylistTeams, setPlaylistUsers } from "@/lib/playlists-db";
import { listLabels, createLabel as apiCreateLabel, updateLabel as apiUpdateLabel, deleteLabel as apiDeleteLabel, seedDefaultLabels, listAssignmentsForClips, setClipAssignments as apiSetClipAssignments, bulkAssign as apiBulkAssign } from "@/lib/labels-db";
import { LabelChip } from "@/components/labels/LabelChip";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import type { Label, LabelColor, ClipKey } from "@scoutable/shared/types/labels";
import { eventColors, eventLabel, formatGameClock, playerName } from "@scoutable/shared/lib/events";
import { getOrgContext, getOrgContextForOrg, getOrgMembers, getTeamMemberIds } from "@/lib/profile-db";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import type { OrgTeam, UserProfile } from "@/types/org";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { exportPlaylist, type ExportSegment } from "@/lib/export";
import { clipAndShip } from "@/lib/clip-and-ship";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { Playlist, PlaylistFolder, PlaylistItem, PlaylistClipItem, PlaylistTextCard, PlayByPlayEvent, StoredMatch, SyncPoint } from "@/types/match";
import { isClipItem } from "@/types/match";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers (mirrors clips-view.tsx)
// ---------------------------------------------------------------------------

function computeVideoTime(event: PlayByPlayEvent, sync: SyncPoint): number | null {
  if (!event.realWorldTime || !sync.syncRealWorldTime) return null;
  const eventMs = new Date(event.realWorldTime).getTime();
  const syncMs = new Date(sync.syncRealWorldTime).getTime();
  if (isNaN(eventMs) || isNaN(syncMs)) return null;
  return sync.syncVideoTime + (eventMs - syncMs) / 1000;
}

function parseGameClock(raw: string): number {
  if (!raw || raw === "—") return -1;
  const parts = raw.split(":");
  if (parts.length < 2) return -1;
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ClockSort = "none" | "asc" | "desc";
type QueueItem = { event: PlayByPlayEvent; matchId: string };
type PlaybackItem = QueueItem | PlaylistTextCard;

function isTextCard(i: PlaybackItem): i is PlaylistTextCard {
  return (i as PlaylistTextCard).type === 'text';
}

function itemKey(i: PlaybackItem): string {
  if (isTextCard(i)) return `text:${i.id}`;
  return `${i.matchId}:${i.event.eventId}`;
}

// ---------------------------------------------------------------------------
// Event type filter options (for clip browser)
// ---------------------------------------------------------------------------

const EVENT_TYPE_OPTIONS = [
  { value: "2pt-made", label: "2PT Made" },
  { value: "2pt-miss", label: "2PT Miss" },
  { value: "3pt-made", label: "3PT Made" },
  { value: "3pt-miss", label: "3PT Miss" },
  { value: "freethrow-made", label: "FT Made" },
  { value: "freethrow-miss", label: "FT Miss" },
  { value: "rebound-off", label: "Off Rebound" },
  { value: "rebound-def", label: "Def Rebound" },
  { value: "rebound-inbound", label: "Inbound Play" },
  { value: "turnover", label: "Turnover" },
  { value: "steal", label: "Steal" },
  { value: "assist", label: "Assist" },
  { value: "foul", label: "Foul" },
  { value: "block", label: "Block" },
];

const SHOT_TYPE_OPTIONS = [
  { value: "subtype:layup", label: "Layup" },
  { value: "subtype:floater", label: "Floater" },
  { value: "subtype:jumpshot", label: "Jump Shot" },
  { value: "subtype:dunk", label: "Dunk / Alley-oop" },
  { value: "subtype:tipin", label: "Tip-in" },
];

const SITUATION_OPTIONS = [
  { value: "qual:fastbreak", label: "Fast Break" },
  { value: "qual:pointsinthepaint", label: "In the Paint" },
  { value: "qual:2ndchance", label: "2nd Chance" },
  { value: "qual:fromturnover", label: "From Turnover" },
  { value: "qual:shooting", label: "Shooting Foul" },
  { value: "subtype:charge", label: "Charge" },
  { value: "subtype:technical", label: "Technical Foul" },
  { value: "subtype:badpass", label: "Bad Pass" },
  { value: "subtype:ballhandling", label: "Ball Handling" },
  { value: "subtype:travel", label: "Travel" },
  { value: "subtype:24sec", label: "Shot Clock" },
];

function matchesSingleType(e: PlayByPlayEvent, filter: string): boolean {
  if (filter === "rebound-off") return e.type === "rebound" && e.subType === "offensive";
  if (filter === "rebound-def") return e.type === "rebound" && e.subType === "defensive";
  if (filter === "rebound-inbound") return e.type === "rebound" && e.subType === "offensivedeadball";
  const [type, outcome] = filter.split("-");
  if (e.type !== type) return false;
  if (outcome === "made") return e.isSuccessful === 1;
  if (outcome === "miss") return e.isSuccessful === 0;
  if (type === "foul") return e.type === "foul" || e.type === "foulon";
  return true;
}

function matchesShotType(e: PlayByPlayEvent, f: string): boolean {
  const sub = e.subType ?? "";
  switch (f) {
    case "subtype:layup":    return ["layup", "drivinglayup", "reverselayup"].includes(sub);
    case "subtype:floater":  return sub === "floatingjumpshot";
    case "subtype:jumpshot": return ["jumpshot", "pullupjumpshot", "turnaroundjumpshot", "fadeaway", "stepbackjumpshot", "hookshot"].includes(sub);
    case "subtype:dunk":     return ["dunk", "alleyoop", "alleyoopdunk"].includes(sub);
    case "subtype:tipin":    return ["tipinlayup", "tipindunk"].includes(sub);
    default: return false;
  }
}

function matchesSituation(e: PlayByPlayEvent, f: string): boolean {
  switch (f) {
    case "qual:fastbreak":        return e.qualifiers.includes("fastbreak");
    case "qual:pointsinthepaint": return e.qualifiers.includes("pointsinthepaint");
    case "qual:2ndchance":        return e.qualifiers.includes("2ndchance");
    case "qual:fromturnover":     return e.qualifiers.includes("fromturnover");
    case "qual:shooting":         return e.type === "foul" && e.qualifiers.includes("shooting");
    case "subtype:charge":        return e.type === "foul" && e.subType === "offensive";
    case "subtype:technical":     return e.type === "foul" && ["technical", "benchTechnical", "coachTechnical"].includes(e.subType ?? "");
    case "subtype:badpass":       return e.type === "turnover" && e.subType === "badpass";
    case "subtype:ballhandling":  return e.type === "turnover" && e.subType === "ballhandling";
    case "subtype:travel":        return e.type === "turnover" && e.subType === "travel";
    case "subtype:24sec":         return e.type === "turnover" && e.subType === "24sec";
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// DraggableRow (used only in manual sort mode)
// ---------------------------------------------------------------------------

interface LabelRowControls {
  labels: Label[];
  assignedIds: Set<string>;
  onToggle: (labelId: string, state: LabelTriState) => Promise<void> | void;
  onCreate: (name: string, color: LabelColor) => Promise<Label>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: LabelColor) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSeedDefaults?: () => Promise<void>;
  scopeTitle?: string;
  scopeHint?: string;
}

function DraggableRow({
  item,
  index,
  isActive,
  isMultiMatch,
  matchTitle,
  preOffset,
  postOffset,
  note,
  isSelected,
  onSelect,
  isDragTarget,
  dragTargetPosition,
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onInsertTextCardAbove,
  onRemove,
  labelControls,
}: {
  item: QueueItem;
  index: number;
  isActive: boolean;
  isMultiMatch: boolean;
  matchTitle?: string;
  preOffset: number;
  postOffset: number;
  note?: string;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  isDragTarget: boolean;
  dragTargetPosition: "above" | "below";
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onInsertTextCardAbove: () => void;
  onRemove: () => void;
  labelControls?: LabelRowControls;
}) {
  const { event } = item;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr
          draggable
          data-event-id={event.eventId}
          className={`group cursor-grab transition-colors hover:bg-muted/50 ${
            isActive ? "bg-primary/10" : ""
          } ${isDragTarget && dragTargetPosition === "above" ? "border-t-2 border-t-primary" : ""} ${
            isDragTarget && dragTargetPosition === "below" ? "border-b-2 border-b-primary" : ""
          }`}
          onClick={onClick}
          onDragStart={onDragStart}
          onDragOver={(e) => onDragOver(e, index)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, index)}
          onDragEnd={onDragEnd}
        >
          <td className={`w-1.5 min-w-1.5 p-0 ${eventColors(event).strip}`} aria-hidden />
          <td className="w-8 px-2 py-2.5">
            <span className="flex items-center justify-center opacity-0 group-hover:opacity-60 transition-opacity">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </td>
          <td className="w-8 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => {}}
              onClick={onSelect}
              className="h-3.5 w-3.5 rounded border-border accent-primary"
            />
          </td>
          <td className="px-4 py-2.5 text-muted-foreground">Q{event.period}</td>
          <td className="px-4 py-2.5 font-mono text-muted-foreground">
            {formatGameClock(event.gameClockTime)}
          </td>
          {isMultiMatch && (
            <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[120px]">
              {matchTitle ?? "—"}
            </td>
          )}
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eventColors(event).badge}`}
              >
                {eventLabel(event)}
              </span>
              {labelControls && (() => {
                const assigned = labelControls.labels.filter((l) => labelControls.assignedIds.has(l.id));
                if (assigned.length === 0) return null;
                const visible = assigned.slice(0, 2);
                const overflow = assigned.slice(2);
                return (
                  <>
                    {visible.map((l) => <LabelChip key={l.id} label={l} />)}
                    {overflow.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground">+{overflow.length}</span>
                        </TooltipTrigger>
                        <TooltipContent>{overflow.map((l) => l.name).join(", ")}</TooltipContent>
                      </Tooltip>
                    )}
                  </>
                );
              })()}
            </div>
          </td>
          <td className="px-4 py-2.5 text-foreground/80">{playerName(event)}</td>
          <td className="px-4 py-2.5 text-muted-foreground">
            {event.eventTeam?.teamName ?? "—"}
          </td>
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-1">
              <Play
                className={`h-3.5 w-3.5 ${
                  isActive ? "text-primary fill-primary" : "text-muted-foreground/30"
                }`}
              />
              {(preOffset !== 0 || postOffset !== 0) && (
                <span
                  className="text-[10px] font-medium text-orange-400"
                  title={`Pre ${preOffset >= 0 ? "+" : ""}${preOffset}s / Post ${postOffset >= 0 ? "+" : ""}${postOffset}s`}
                >
                  ±
                </span>
              )}
              {note && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <MessageSquare className="ml-0.5 h-3 w-3 shrink-0 text-primary/60" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-56 whitespace-pre-wrap">{note}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </td>
          <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-0.5">
              {labelControls && (
                <LabelPickerPopover
                  trigger={
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 data-[state=open]:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                      title={labelControls.scopeTitle ?? "Labels"}
                    >
                      <Tag className="h-3.5 w-3.5" />
                    </button>
                  }
                  labels={labelControls.labels}
                  assignedAllIds={labelControls.assignedIds}
                  onToggle={labelControls.onToggle}
                  onCreate={labelControls.onCreate}
                  onRename={labelControls.onRename}
                  onRecolor={labelControls.onRecolor}
                  onDelete={labelControls.onDelete}
                  onSeedDefaults={labelControls.onSeedDefaults}
                  scopeTitle={labelControls.scopeTitle}
                  scopeHint={labelControls.scopeHint}
                />
              )}
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title="Remove from playlist"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        </tr>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onInsertTextCardAbove}>
          Insert text card above
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// TextCardRow
// ---------------------------------------------------------------------------

function TextCardRow({
  card,
  index,
  isActive,
  isSelected,
  onSelect,
  isDragTarget,
  dragTargetPosition,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onTextChange,
  onTextSave,
  onDurationChange,
  onClick,
  onRemove,
}: {
  card: PlaylistTextCard;
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  isDragTarget: boolean;
  dragTargetPosition: "above" | "below";
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onTextChange: (id: string, text: string) => void;
  onTextSave: (id: string, text: string) => void;
  onDurationChange: (id: string, duration: number) => void;
  onClick: () => void;
  onRemove: () => void;
}) {
  const [durationOpen, setDurationOpen] = useState(false);
  const [draftDuration, setDraftDuration] = useState(String(card.durationSeconds));

  return (
    <tr
      draggable
      data-text-card-id={card.id}
      className={`group cursor-grab transition-colors bg-amber-50/30 dark:bg-amber-950/20 hover:bg-amber-100/40 dark:hover:bg-amber-900/30 ${
        isActive ? "ring-1 ring-inset ring-amber-400" : ""
      } ${isDragTarget && dragTargetPosition === "above" ? "border-t-2 border-t-primary" : ""} ${
        isDragTarget && dragTargetPosition === "below" ? "border-b-2 border-b-primary" : ""
      }`}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
    >
      <td className="w-1.5 min-w-1.5 p-0 bg-amber-400" aria-hidden />
      <td className="w-8 px-2 py-2.5">
        <span className="flex items-center justify-center opacity-0 group-hover:opacity-60 transition-opacity">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
      </td>
      <td className="w-8 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => {}}
          onClick={onSelect}
          className="h-3.5 w-3.5 rounded border-border accent-primary"
        />
      </td>
      {/* Icon */}
      <td className="px-4 py-2.5" colSpan={2}>
        <div className="flex items-center gap-2">
          <Type className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <input
            type="text"
            value={card.text}
            placeholder="Text card…"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-0 border-none"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onTextChange(card.id, e.target.value)}
            onBlur={(e) => onTextSave(card.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      </td>
      <td className="px-4 py-2.5" colSpan={4}>
        <div className="flex items-center gap-2">
          <Popover open={durationOpen} onOpenChange={(open) => {
            setDurationOpen(open);
            if (open) setDraftDuration(String(card.durationSeconds));
          }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                {card.durationSeconds}s
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-3" onClick={(e) => e.stopPropagation()}>
              <label className="text-xs text-muted-foreground block mb-1.5">Duration (seconds)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={draftDuration}
                  onChange={(e) => setDraftDuration(e.target.value)}
                  className="h-7 w-full rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = Number(draftDuration);
                      if (n > 0) onDurationChange(card.id, n);
                      setDurationOpen(false);
                    }
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                  onClick={() => {
                    const n = Number(draftDuration);
                    if (n > 0) onDurationChange(card.id, n);
                    setDurationOpen(false);
                  }}
                >
                  OK
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from playlist"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// ClipBrowserPanel — cross-match clip selection
// ---------------------------------------------------------------------------

function ClipBrowserPanel({
  matches,
  matchLookup,
  playlist,
  onAddClips,
  onClose,
  activeOrgId,
  labels,
  labelHandlers,
}: {
  matches: StoredMatch[];
  matchLookup: Map<string, StoredMatch>;
  playlist: Playlist;
  onAddClips: (clips: PlaylistClipItem[]) => void;
  onClose: () => void;
  activeOrgId: string | null;
  labels: Label[];
  labelHandlers: {
    onCreate: (name: string, color: LabelColor) => Promise<Label>;
    onRename: (id: string, name: string) => Promise<void>;
    onRecolor: (id: string, color: LabelColor) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onSeedDefaults: () => Promise<void>;
  };
}) {
  const [filterMatchId, setFilterMatchId] = useState<string | null>(matches[0]?.id ?? null);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterSubTypes, setFilterSubTypes] = useState<Set<string>>(new Set());
  const [filterSituations, setFilterSituations] = useState<Set<string>>(new Set());
  const [filterTeams, setFilterTeams] = useState<Set<string>>(new Set());
  const [filterPlayers, setFilterPlayers] = useState<Set<string>>(new Set());
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());
  const [preRoll, setPreRoll] = useState(10);
  const [postRoll, setPostRoll] = useState(3);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // "matchId:eventId"
  // Local assignment state for the visible match.
  const [clipAssignments, setClipAssignments] = useState<Map<string, Set<string>>>(new Map());
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [queueIdx, setQueueIdx] = useState(0);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Refs to avoid stale closures in timeupdate handler
  const preRollRef = useRef(preRoll);
  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  const postRollRef = useRef(postRoll);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  const clipEndRef = useRef<number | undefined>(undefined);
  const pendingSeekRef = useRef<{ event: PlayByPlayEvent; matchId: string } | null>(null);
  const queueRef = useRef<Array<{ event: PlayByPlayEvent; matchId: string }>>([]);
  const queueIdxRef = useRef(0);
  const activeEventKeyRef = useRef(activeEventKey);
  useEffect(() => { activeEventKeyRef.current = activeEventKey; }, [activeEventKey]);

  const existingSet = useMemo(
    () => new Set(playlist.items.filter(isClipItem).map((c) => `${c.matchId}:${c.eventId}`)),
    [playlist.items]
  );

  const allEvents = useMemo(() => {
    const source = filterMatchId ? matches.filter((m) => m.id === filterMatchId) : matches;
    return source.flatMap((m) => m.events.map((e) => ({ event: e, matchId: m.id, matchTitle: m.title })));
  }, [matches, filterMatchId]);

  const teams = useMemo(() =>
    Array.from(new Set(allEvents.map((x) => x.event.eventTeam?.teamName).filter(Boolean) as string[])),
    [allEvents]
  );
  const players = useMemo(() => {
    const source = filterTeams.size > 0
      ? allEvents.filter(({ event }) => filterTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    return Array.from(new Set(
      source.map((x) => x.event.player ? playerName(x.event) : null).filter(Boolean) as string[]
    ));
  }, [allEvents, filterTeams]);

  const filtered = useMemo(() => allEvents.filter(({ event, matchId }) => {
    if (filterTypes.size > 0 && !Array.from(filterTypes).some((f) => matchesSingleType(event, f))) return false;
    if (filterSubTypes.size > 0 && !Array.from(filterSubTypes).some((f) => matchesShotType(event, f))) return false;
    if (filterSituations.size > 0 && !Array.from(filterSituations).some((f) => matchesSituation(event, f))) return false;
    if (filterTeams.size > 0 && !filterTeams.has(event.eventTeam?.teamName ?? "")) return false;
    if (filterPlayers.size > 0 && !filterPlayers.has(playerName(event))) return false;
    if (filterLabelIds.size > 0) {
      const assigned = clipAssignments.get(`${matchId}:${event.eventId}`);
      if (!assigned || ![...filterLabelIds].some((id) => assigned.has(id))) return false;
    }
    return true;
  }), [allEvents, filterTypes, filterSubTypes, filterSituations, filterTeams, filterPlayers, filterLabelIds, clipAssignments]);

  // Load bank-scope assignments for the visible match(es) — refreshes on
  // game change. The bank surfaces only playlist_id IS NULL rows.
  useEffect(() => {
    if (!activeOrgId || allEvents.length === 0) { setClipAssignments(new Map()); return; }
    const clips: ClipKey[] = allEvents.map(({ event, matchId }) => ({ matchId, eventId: event.eventId }));
    listAssignmentsForClips(activeOrgId, clips, null)
      .then((rows) => {
        const next = new Map<string, Set<string>>();
        for (const r of rows) {
          const key = `${r.matchId}:${r.eventId}`;
          const set = next.get(key) ?? new Set<string>();
          set.add(r.labelId);
          next.set(key, set);
        }
        setClipAssignments(next);
      })
      .catch((e) => console.error("browser listAssignmentsForClips:", e));
  }, [activeOrgId, allEvents]);

  const selectedClipKeyPairs = useMemo<ClipKey[]>(() => {
    const out: ClipKey[] = [];
    for (const key of selectedIds) {
      const [matchId, eventIdStr] = key.split(":");
      const eventId = Number(eventIdStr);
      if (matchId && Number.isFinite(eventId)) out.push({ matchId, eventId });
    }
    return out;
  }, [selectedIds]);

  const { bulkAssignedAll, bulkAssignedSome } = useMemo(() => {
    const all = new Set<string>();
    const some = new Set<string>();
    if (selectedClipKeyPairs.length === 0) return { bulkAssignedAll: all, bulkAssignedSome: some };
    const counts = new Map<string, number>();
    for (const { matchId, eventId } of selectedClipKeyPairs) {
      const s = clipAssignments.get(`${matchId}:${eventId}`);
      if (!s) continue;
      for (const id of s) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = selectedClipKeyPairs.length;
    for (const [id, n] of counts.entries()) {
      if (n === total) all.add(id);
      else if (n > 0) some.add(id);
    }
    return { bulkAssignedAll: all, bulkAssignedSome: some };
  }, [selectedClipKeyPairs, clipAssignments]);

  const handleToggleClipLabel = useCallback(
    async (matchId: string, eventId: number, labelId: string, state: LabelTriState) => {
      if (!activeOrgId) return;
      const nextAssigned = state !== "all";
      const key = `${matchId}:${eventId}`;
      setClipAssignments((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(key) ?? []);
        if (nextAssigned) set.add(labelId); else set.delete(labelId);
        next.set(key, set);
        return next;
      });
      try {
        const existing = clipAssignments.get(key) ?? new Set<string>();
        const wanted = new Set(existing);
        if (nextAssigned) wanted.add(labelId); else wanted.delete(labelId);
        await apiSetClipAssignments(activeOrgId, matchId, eventId, Array.from(wanted), null);
      } catch (e) {
        console.error("toggle clip label:", e);
        toast.error("Failed to update label");
      }
    },
    [activeOrgId, clipAssignments],
  );

  const handleBulkToggleLabel = useCallback(
    async (labelId: string, state: LabelTriState) => {
      if (!activeOrgId || selectedClipKeyPairs.length === 0) return;
      const mode: "add" | "remove" = state === "all" ? "remove" : "add";
      setClipAssignments((prev) => {
        const next = new Map(prev);
        for (const { matchId, eventId } of selectedClipKeyPairs) {
          const key = `${matchId}:${eventId}`;
          const set = new Set(next.get(key) ?? []);
          if (mode === "add") set.add(labelId); else set.delete(labelId);
          next.set(key, set);
        }
        return next;
      });
      try {
        await apiBulkAssign(activeOrgId, selectedClipKeyPairs, labelId, mode, null);
      } catch (e) {
        console.error("bulk toggle label:", e);
        toast.error("Failed to apply label");
      }
    },
    [activeOrgId, selectedClipKeyPairs],
  );

  function handleGameChange(newMatchId: string | null) {
    setFilterMatchId(newMatchId);
    setFilterTeams(new Set());
    setFilterPlayers(new Set());
  }

  function handleTeamChange(newTeams: Set<string>) {
    setFilterTeams(newTeams);
    const source = newTeams.size > 0
      ? allEvents.filter(({ event }) => newTeams.has(event.eventTeam?.teamName ?? ""))
      : allEvents;
    const validPlayers = new Set(
      source.map((x) => x.event.player ? playerName(x.event) : null).filter(Boolean) as string[]
    );
    setFilterPlayers((prev) => new Set([...prev].filter((p) => validPlayers.has(p))));
  }

  // Keep ref for arrow key handler (avoids stale closures in global listener)
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const videoMatchId = activeEventKey
    ? activeEventKey.split(":")[0]
    : filterMatchId ?? null;
  const localVideoUrl = useMemo(() => {
    const match = videoMatchId ? matchLookup.get(videoMatchId) : null;
    if (!match?.videoUrl) return null;
    return isLocalPath(match.videoUrl) ? streamFileSrc(match.videoUrl) : match.videoUrl;
  }, [videoMatchId, matchLookup]);

  // Seek to an event — pause → seek → play, sets clipEnd for auto-advance
  const seekToEvent = useCallback((event: PlayByPlayEvent, matchId: string) => {
    const match = matchLookup.get(matchId);
    const video = videoRef.current;
    if (!match?.syncPoint || !video) return;
    const videoTime = computeVideoTime(event, match.syncPoint);
    if (videoTime === null) return;
    const seekTo = Math.max(0, videoTime - preRollRef.current);
    const clipEnd = videoTime + postRollRef.current;
    clipEndRef.current = undefined;
    video.pause();
    const target1 = seekTo;
    function onSeeked1() {
      if (video!.currentTime > target1 + 2) { video!.addEventListener("seeked", onSeeked1, { once: true }); return; }
      clipEndRef.current = clipEnd;
      video!.play().catch(() => {});
    }
    video.addEventListener("seeked", onSeeked1, { once: true });
    video.currentTime = seekTo;
  }, [matchLookup]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep seek ref current so timeupdate handler always calls the latest version
  const seekToEventRef = useRef(seekToEvent);
  seekToEventRef.current = seekToEvent;

  // Auto-advance to next clip via timeupdate
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleTimeUpdate() {
      const end = clipEndRef.current;
      if (end === undefined || !video) return;
      if (video.currentTime < end) return;
      // Guard: if we're >60s past clipEnd the video is at a stale position (seek in progress)
      if (video.currentTime > end + 60) return;

      clipEndRef.current = undefined;
      video.pause();
      const nextIdx = queueIdxRef.current + 1;
      const queue = queueRef.current;

      if (nextIdx < queue.length) {
        queueIdxRef.current = nextIdx;
        setQueueIdx(nextIdx);
        const { event, matchId } = queue[nextIdx];
        const key = `${matchId}:${event.eventId}`;
        setActiveEventKey(key);
        activeEventKeyRef.current = key;
        seekToEventRef.current(event, matchId);
      } else {
        video.pause();
        setIsPlaying(false);
        setActiveEventKey(null);
        queueRef.current = [];
      }
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [localVideoUrl]); // re-attach when video element is (re-)mounted

  // Deferred seek: fires once the video element is (re-)mounted after a match switch
  useEffect(() => {
    const pending = pendingSeekRef.current;
    const video = videoRef.current;
    if (!pending || !video) return;
    pendingSeekRef.current = null;
    const doSeek = () => seekToEvent(pending.event, pending.matchId);
    if (video.readyState >= 1) doSeek();
    else video.addEventListener("loadedmetadata", doSeek, { once: true });
  }, [localVideoUrl, seekToEvent]);

  function handleStop() {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setQueueIdx(0);
    clipEndRef.current = undefined;
    setIsPlaying(false);
    setActiveEventKey(null);
    videoRef.current?.pause();
  }

  function handleReplay() {
    const item = queueRef.current[queueIdxRef.current];
    if (item) seekToEvent(item.event, item.matchId);
  }
  const handleReplayRef = useRef(handleReplay);
  handleReplayRef.current = handleReplay;

  const handleRowClick = useCallback((event: PlayByPlayEvent, matchId: string) => {
    const items = filteredRef.current;
    const idx = items.findIndex((x) => x.event.eventId === event.eventId && x.matchId === matchId);
    const queue = idx >= 0 ? items.slice(idx) : [{ event, matchId, matchTitle: "" }];

    queueRef.current = queue;
    queueIdxRef.current = 0;
    setQueueIdx(0);
    setIsPlaying(true);
    setActiveEventKey(`${matchId}:${event.eventId}`);

    if (videoRef.current) {
      seekToEvent(event, matchId);
    } else {
      // Video element not yet mounted (match switch); pendingSeekRef effect fires once it mounts
      pendingSeekRef.current = { event, matchId };
    }
  }, [seekToEvent]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleRowClickRef = useRef(handleRowClick);
  handleRowClickRef.current = handleRowClick;

  function handlePrev() {
    const items = filteredRef.current;
    const cur = items.findIndex((x) => `${x.matchId}:${x.event.eventId}` === activeEventKeyRef.current);
    if (cur <= 0) return;
    const { event, matchId } = items[cur - 1];
    handleRowClickRef.current(event, matchId);
  }

  function handleNext() {
    const items = filteredRef.current;
    const cur = items.findIndex((x) => `${x.matchId}:${x.event.eventId}` === activeEventKeyRef.current);
    if (cur === -1 || cur >= items.length - 1) return;
    const { event, matchId } = items[cur + 1];
    handleRowClickRef.current(event, matchId);
  }

  function handlePlayAll() {
    const items = filteredRef.current;
    if (items.length === 0) return;
    handleRowClick(items[0].event, items[0].matchId);
  }

  const activeIdx = filtered.findIndex(({ event, matchId }) => `${matchId}:${event.eventId}` === activeEventKey);
  const canPrev = isPlaying && activeIdx > 0;
  const canNext = isPlaying && activeIdx >= 0 && activeIdx < filtered.length - 1;
  const isQueueActive = isPlaying;

  // Arrow key navigation: ↓/↑ = next/prev clip, ← = replay
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "ArrowDown" && e.code !== "ArrowUp" && e.code !== "ArrowLeft") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      if (e.code === "ArrowLeft") { handleReplayRef.current(); return; }
      const items = filteredRef.current;
      if (items.length === 0) return;
      const cur = items.findIndex((x) => `${x.matchId}:${x.event.eventId}` === activeEventKeyRef.current);
      const next =
        e.code === "ArrowDown"
          ? cur === -1 ? 0 : Math.min(cur + 1, items.length - 1)
          : cur === -1 ? items.length - 1 : Math.max(cur - 1, 0);
      if (next !== cur || cur === -1) {
        const { event, matchId } = items[next];
        handleRowClickRef.current(event, matchId);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Scroll active row into view
  useEffect(() => {
    if (activeEventKey === null) return;
    const eventId = activeEventKey.split(":")[1];
    document.querySelector(`[data-event-id="${eventId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeEventKey]);

  const allSelected = filtered.length > 0 && filtered.every(({ event, matchId }) => selectedIds.has(`${matchId}:${event.eventId}`));

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(({ event, matchId }) => `${matchId}:${event.eventId}`)));
    }
  }

  function toggleOne(key: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleAdd() {
    const toAdd: PlaylistClipItem[] = filtered
      .filter(({ event, matchId }) => {
        const key = `${matchId}:${event.eventId}`;
        return selectedIds.has(key) && !existingSet.has(key);
      })
      .map(({ event, matchId }) => ({ type: 'clip' as const, matchId, eventId: event.eventId }));
    onAddClips(toAdd);
    onClose();
  }

  const newCount = Array.from(selectedIds).filter((k) => !existingSet.has(k)).length;
  const isMultiMatch = filterMatchId === null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">Add Clips to Playlist</span>
          <span className="text-xs text-muted-foreground">
            Adding to: <span className="font-medium text-foreground">{playlist.name}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {activeOrgId && selectedClipKeyPairs.length > 0 && (
            <LabelPickerPopover
              trigger={
                <Button size="sm" variant="outline" className="h-8 gap-1.5" title="Bank labels">
                  <Tag className="h-3.5 w-3.5" />
                  Apply bank label
                  <ChevronDown className="h-3 w-3" />
                </Button>
              }
              labels={labels}
              assignedAllIds={bulkAssignedAll}
              assignedSomeIds={bulkAssignedSome}
              onToggle={handleBulkToggleLabel}
              onCreate={labelHandlers.onCreate}
              onRename={labelHandlers.onRename}
              onRecolor={labelHandlers.onRecolor}
              onDelete={labelHandlers.onDelete}
              onSeedDefaults={labelHandlers.onSeedDefaults}
              scopeTitle="Bank labels"
              scopeHint="Use these to find clips later — not visible inside playlists"
            />
          )}
          <span title={newCount === 0 ? "Select clips to add them" : undefined}>
            <Button
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleAdd}
              disabled={newCount === 0}
            >
              <Plus className="h-3.5 w-3.5" />
              Add {newCount > 0 ? newCount : ""} clip{newCount !== 1 ? "s" : ""}
            </Button>
          </span>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filters — same labeled layout as ClipsView */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border shrink-0">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Game</label>
          <SingleSelectDropdown
            options={matches.map((m) => ({ value: m.id, label: m.title }))}
            value={filterMatchId}
            onChange={handleGameChange}
            placeholder="All games"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Event type</label>
          <MultiSelectDropdown
            options={EVENT_TYPE_OPTIONS}
            selected={filterTypes}
            onChange={setFilterTypes}
            placeholder="All types"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Shot type</label>
          <MultiSelectDropdown
            options={SHOT_TYPE_OPTIONS}
            selected={filterSubTypes}
            onChange={setFilterSubTypes}
            placeholder="All shots"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Situation</label>
          <MultiSelectDropdown
            options={SITUATION_OPTIONS}
            selected={filterSituations}
            onChange={setFilterSituations}
            placeholder="Any situation"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Team</label>
          <MultiSelectDropdown
            options={teams.map((t) => ({ value: t, label: t }))}
            selected={filterTeams}
            onChange={handleTeamChange}
            placeholder="All teams"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Player</label>
          <MultiSelectDropdown
            options={players.map((p) => ({ value: p, label: p }))}
            selected={filterPlayers}
            onChange={setFilterPlayers}
            placeholder="All players"
          />
        </div>

        {labels.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Labels</label>
            <MultiSelectDropdown
              options={labels.map((l) => ({ value: l.id, label: l.name }))}
              selected={filterLabelIds}
              onChange={setFilterLabelIds}
              placeholder="Any label"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Pre-roll (s)</label>
          <Input
            type="number"
            min={0}
            max={30}
            className="h-9 w-20"
            value={preRoll}
            onChange={(e) => setPreRoll(Number(e.target.value))}
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Post-roll (s)</label>
          <Input
            type="number"
            min={0}
            max={60}
            className="h-9 w-20"
            value={postRoll}
            onChange={(e) => setPostRoll(Number(e.target.value))}
          />
        </div>

        <div className="ml-auto self-end pb-0.5 text-xs text-muted-foreground">{filtered.length} events</div>
      </div>

      {/* Content: event table | video player */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={55} minSize={30}>
          <div className="h-full overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  {matches.length === 0
                    ? "No games imported yet. Add a game in the Library to get started."
                    : "No events match the current filters. Try adjusting them."}
                </p>
                {matches.length === 0 && (
                  <Link to="/matches">
                    <Button size="sm" variant="outline" className="text-xs">
                      Go to Library
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted/80 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded border-border accent-primary"
                      />
                    </th>
                    <th className="px-4 py-2.5 text-left">Period</th>
                    <th className="px-4 py-2.5 text-left">Clock</th>
                    {isMultiMatch && <th className="px-4 py-2.5 text-left">Game</th>}
                    <th className="px-4 py-2.5 text-left">Event</th>
                    <th className="px-4 py-2.5 text-left">Player</th>
                    <th className="px-4 py-2.5 text-left">Team</th>
                    <th className="px-4 py-2.5 text-left"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-card">
                  {filtered.map(({ event, matchId, matchTitle }) => {
                    const key = `${matchId}:${event.eventId}`;
                    const isSelected = selectedIds.has(key);
                    const alreadyIn = existingSet.has(key);
                    const isActive = activeEventKey === key;
                    return (
                      <tr
                        key={key}
                        data-event-id={event.eventId}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/clip", key);
                          e.dataTransfer.effectAllowed = "copy";
                          setDraggingKey(key);
                        }}
                        onDragEnd={() => setDraggingKey(null)}
                        className={`cursor-pointer transition-colors hover:bg-muted/50 ${isActive ? "bg-primary/10" : isSelected ? "bg-primary/5" : ""} ${alreadyIn ? "opacity-40" : ""} ${draggingKey === key ? "opacity-50" : ""}`}
                        onClick={() => handleRowClick(event, matchId)}
                      >
                        <td className="w-8 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={alreadyIn}
                            onChange={() => {}}
                            onClick={(e) => { e.stopPropagation(); if (!alreadyIn) toggleOne(key); }}
                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                          />
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">Q{event.period}</td>
                        <td className="px-4 py-2.5 font-mono text-muted-foreground">{formatGameClock(event.gameClockTime)}</td>
                        {isMultiMatch && (
                          <td className="px-4 py-2.5 text-xs text-muted-foreground truncate max-w-[120px]">{matchTitle}</td>
                        )}
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${eventColors(event).badge}`}>
                              {eventLabel(event)}
                            </span>
                            {activeOrgId && (() => {
                              const assigned = labels.filter((l) => clipAssignments.get(key)?.has(l.id));
                              if (assigned.length === 0) return null;
                              const visible = assigned.slice(0, 2);
                              const overflow = assigned.slice(2);
                              return (
                                <>
                                  {visible.map((l) => <LabelChip key={l.id} label={l} />)}
                                  {overflow.length > 0 && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-xs text-muted-foreground">+{overflow.length}</span>
                                      </TooltipTrigger>
                                      <TooltipContent>{overflow.map((l) => l.name).join(", ")}</TooltipContent>
                                    </Tooltip>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-foreground/80">{playerName(event)}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{event.eventTeam?.teamName ?? "—"}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Play
                              className={`h-3.5 w-3.5 ${
                                isActive ? "text-primary" : "text-muted-foreground/40"
                              }`}
                            />
                            {activeOrgId && (
                              <LabelPickerPopover
                                trigger={
                                  <button
                                    type="button"
                                    className="rounded p-0.5 text-muted-foreground hover:text-primary hover:bg-primary/10 data-[state=open]:text-primary"
                                    title="Bank labels"
                                  >
                                    <Tag className="h-3.5 w-3.5" />
                                  </button>
                                }
                                labels={labels}
                                assignedAllIds={clipAssignments.get(key) ?? new Set<string>()}
                                onToggle={(labelId, state) => handleToggleClipLabel(matchId, event.eventId, labelId, state)}
                                onCreate={labelHandlers.onCreate}
                                onRename={labelHandlers.onRename}
                                onRecolor={labelHandlers.onRecolor}
                                onDelete={labelHandlers.onDelete}
                                onSeedDefaults={labelHandlers.onSeedDefaults}
                                scopeTitle="Bank labels"
                                scopeHint="Use these to find clips later — not visible inside playlists"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel defaultSize={45} minSize={25}>
          <div className="flex h-full flex-col gap-2 p-4">
            {localVideoUrl ? (
              <>
                <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                <VideoClipControls
                  videoRef={videoRef}
                  canPrev={canPrev}
                  canNext={canNext}
                  isQueueActive={isQueueActive}
                  onPrev={handlePrev}
                  onNext={handleNext}
                  onReplay={handleReplay}
                  onStop={handleStop}
                  onPlayAll={handlePlayAll}
                />
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-center text-sm text-muted-foreground">
                  Select a game with video to preview clips
                </p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddToDropdown
// ---------------------------------------------------------------------------

function AddToDropdown({
  playlists,
  activePlaylistId,
  addToSearch,
  setAddToSearch,
  onAddToPlaylist,
}: {
  playlists: Playlist[];
  activePlaylistId: string | null;
  addToSearch: string;
  setAddToSearch: (v: string) => void;
  onAddToPlaylist: (playlist: Playlist) => void;
}) {
  const q = addToSearch.toLowerCase();
  const options = playlists.filter((pl) => {
    if (activePlaylistId && pl.id === activePlaylistId) return false;
    if (q && !pl.name.toLowerCase().includes(q)) return false;
    return true;
  });
  return (
    <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-border bg-popover shadow-lg">
      <div className="border-b border-border p-2">
        <input
          autoFocus
          type="text"
          placeholder="Search playlists…"
          value={addToSearch}
          onChange={(e) => setAddToSearch(e.target.value)}
          className="w-full rounded-sm bg-muted px-2 py-1 text-xs outline-none"
        />
      </div>
      {options.length > 0 ? (
        <div className="max-h-60 overflow-y-auto py-1">
          {options.map((pl) => (
            <button
              key={pl.id}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onAddToPlaylist(pl)}
            >
              <span className="flex-1 truncate">{pl.name}</span>
              <span className="text-xs text-muted-foreground">{pl.items.length}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="px-3 py-3 text-xs text-muted-foreground">No playlists found</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlaylistsPage() {
  const { activeOrgId, activeOrgPlan, activeOrgRole, activeOrgIsPersonal, profileLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  const [activeEventId, setActiveEventId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [preRoll, setPreRoll] = useState(10);
  const [postRoll, setPostRoll] = useState(3);
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const saved = sessionStorage.getItem("expandedFolders");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(() => {
    const saved = sessionStorage.getItem("uncategorizedExpanded");
    return saved !== null ? saved === "true" : true;
  });
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [pendingNewFolderId, setPendingNewFolderId] = useState<string | null>(null);
  const [pendingNewPlaylistId, setPendingNewPlaylistId] = useState<string | null>(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState("");
  const [openMenuPlaylistId, setOpenMenuPlaylistId] = useState<string | null>(null);
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null);
  const [clockSort, setClockSort] = useState<ClockSort>("none");
  const [search, setSearch] = useState("");
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isShipping, setIsShipping] = useState(false);
  const [shipProgress, setShipProgress] = useState<{ done: number; total: number } | null>(null);
  const [userTeams, setUserTeams] = useState<OrgTeam[]>([]);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());
  const [pendingShareUserIds, setPendingShareUserIds] = useState<Set<string>>(new Set());
  const [shareableMembers, setShareableMembers] = useState<UserProfile[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [sharedSectionExpanded, setSharedSectionExpanded] = useState(true);
  // Clip browser panel
  const [showClipBrowser, setShowClipBrowser] = useState(false);

  // Labels — per (user, org) vocabulary + per-clip assignments
  const [labels, setLabels] = useState<Label[]>([]);
  // Map keyed `${matchId}:${eventId}` -> Set of labelIds assigned to that clip
  const [clipAssignments, setClipAssignments] = useState<Map<string, Set<string>>>(new Map());

  // Clip drag state
  const [clipDragKey, setClipDragKey] = useState<string | null>(null);
  const [clipDragOverIndex, setClipDragOverIndex] = useState<number | null>(null);
  const [clipDragOverPosition, setClipDragOverPosition] = useState<"above" | "below">("below");
  const [clipDragOverPlaylistId, setClipDragOverPlaylistId] = useState<string | null>(null);
  const [clipExpandFolderId, setClipExpandFolderId] = useState<string | null>(null);
  const [clipOpenPlaylistId, setClipOpenPlaylistId] = useState<string | null>(null);
  const clipDragFolderExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipDragPlaylistOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCursorRef = useRef<{ x: number; y: number } | null>(null);
  const dragCursorListenerRef = useRef<((ev: DragEvent) => void) | null>(null);
  const dragScrollRAFRef = useRef<number | null>(null);
  const playlistScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  // Refs mirroring state — used inside the RAF loop where direct state access is stale.
  // clipDragOverPlaylistIdRef is updated synchronously alongside its state setter (no effect sync).
  const clipDragOverPlaylistIdRef = useRef<string | null>(null);
  const playlistsRef = useRef<Playlist[]>([]);
  const browserPanelRef = usePanelRef();

  // Text card playback
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);
  const textCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTextCardRef = useRef<PlaylistTextCard | null>(null);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);

  const [newlyInsertedCardId, setNewlyInsertedCardId] = useState<string | null>(null);

  // Item selection (clips and text cards)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set()); // "matchId:eventId" or "text:uuid"
  const [showAddToDropdown, setShowAddToDropdown] = useState(false);
  const [addToSearch, setAddToSearch] = useState("");
  const addToDropdownRef = useRef<HTMLDivElement>(null);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const queueRef = useRef<PlaybackItem[]>([]);
  const queueIdxRef = useRef<number>(0);
  const [clipNote, setClipNote] = useState("");
  const [theaterMode, setTheaterMode] = useState(
    () => sessionStorage.getItem("playlists-theater-mode") === "true"
  );
  useEffect(() => {
    sessionStorage.setItem("playlists-theater-mode", String(theaterMode));
  }, [theaterMode]);

  const clipNoteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipEndRef = useRef<number | undefined>(undefined);
  const pendingSeekRef = useRef<{ seekTo: number; clipEnd: number } | null>(null);
  const preRollRef = useRef(preRoll);
  const postRollRef = useRef(postRoll);
  const activeMatchIdRef = useRef<string | null>(null);
  const selectedRef = useRef(selected);

  useEffect(() => { preRollRef.current = preRoll; }, [preRoll]);
  useEffect(() => { postRollRef.current = postRoll; }, [postRoll]);
  useEffect(() => { activeMatchIdRef.current = activeMatchId; }, [activeMatchId]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { playlistsRef.current = playlists; }, [playlists]);
  useEffect(() => { sessionStorage.setItem("expandedFolders", JSON.stringify([...expandedFolders])); }, [expandedFolders]);
  useEffect(() => { sessionStorage.setItem("uncategorizedExpanded", String(uncategorizedExpanded)); }, [uncategorizedExpanded]);

  // Sync note textarea when active clip changes
  useEffect(() => {
    if (activeEventId === null || !selected) { setClipNote(""); return; }
    // Find the clip in the queue to get its matchId
    const queueItem = queueRef.current.find(
      (i): i is QueueItem => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId
    );
    const clip = selected.items.filter(isClipItem).find(
      (c) => c.matchId === (queueItem?.matchId ?? activeMatchIdRef.current) && c.eventId === activeEventId
    );
    setClipNote(clip?.note ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEventId, selected?.id]);

  // Load playlists + matches on mount; restore selection if returning from match detail
  useEffect(() => {
    const state = location.state as { restore?: { playlistId: string }; createNew?: boolean } | null;
    const restore = state?.restore;
    const createNew = state?.createNew;
    Promise.all([listPlaylists(), listMatchesLight(activeOrgId ?? undefined, { ownOnly: true }), listFolders(), (activeOrgId ? getOrgContextForOrg(activeOrgId) : getOrgContext()).catch(() => null)])
      .then(async ([loadedPlaylists, matchShells, loadedFolders, orgCtx]) => {
        const matchIds = matchShells.map((m) => m.id);
        const eventsByMatch = await listEventsForMatches(matchIds).catch(() => ({} as Record<string, PlayByPlayEvent[]>));
        const loadedMatches = matchShells.map((m) => ({ ...m, events: eventsByMatch[m.id] ?? [] }));

        setPlaylists(loadedPlaylists);
        setMatches(loadedMatches);
        const sorted = [...loadedFolders].sort((a, b) => a.sortOrder - b.sortOrder);
        setFolders(sorted);
        if (orgCtx) {
          setUserTeams(orgCtx.myTeams);
          // Load members of coach's teams for individual sharing (includes secondary org members)
          const myTeamIds = orgCtx.myTeams.map((t) => t.id);
          if (myTeamIds.length > 0) {
            const secondaryOrgIds = orgCtx.myOrgs.filter((o) => o.orgId !== orgCtx.org?.id).map((o) => o.orgId);
            Promise.all([
              getTeamMemberIds(myTeamIds),
              ...secondaryOrgIds.map((id) => getOrgMembers(id)),
            ]).then(([memberIds, ...secondaryMemberArrays]) => {
              const memberIdSet = new Set(memberIds);
              const currentUid = orgCtx.profile.id;
              const allMembers = new Map<string, (typeof orgCtx.orgMembers)[0]>(
                [...orgCtx.orgMembers, ...secondaryMemberArrays.flat()].map((m) => [m.id, m])
              );
              setShareableMembers(
                [...allMembers.values()].filter((m) => memberIdSet.has(m.id) && m.id !== currentUid)
              );
            });
          }
        }
        if (restore) {
          const pl = loadedPlaylists.find((p) => p.id === restore.playlistId);
          if (pl) {
            setSelected(pl);
            if (pl.folderId) {
              setExpandedFolders((prev) => new Set([...prev, pl.folderId!]));
            } else {
              setUncategorizedExpanded(true);
            }
          }
        } else if (createNew) {
          const tempId = `temp-${Date.now()}`;
          const tempPlaylist: Playlist = { id: tempId, name: "New Playlist", items: [], folderId: undefined };
          setPendingNewPlaylistId(tempId);
          setPlaylists((prev) => [tempPlaylist, ...prev]);
          setUncategorizedExpanded(true);
          setEditingPlaylistId(tempId);
          setEditPlaylistName("New Playlist");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  // Load label vocabulary for the active org. Re-runs when org switches.
  useEffect(() => {
    if (!activeOrgId) { setLabels([]); return; }
    listLabels(activeOrgId)
      .then((rows) => setLabels(rows))
      .catch((e) => console.error("listLabels:", e));
  }, [activeOrgId]);

  // Load label assignments for the selected playlist's clips.
  // Scope is the active playlist's id — labels here are playlist-scoped.
  useEffect(() => {
    if (!activeOrgId || !selected) { setClipAssignments(new Map()); return; }
    const clipKeys: ClipKey[] = selected.items
      .filter(isClipItem)
      .map((c) => ({ matchId: c.matchId, eventId: c.eventId }));
    if (clipKeys.length === 0) { setClipAssignments(new Map()); return; }
    const playlistScopeId = selected.id;
    listAssignmentsForClips(activeOrgId, clipKeys, playlistScopeId)
      .then((rows) => {
        const next = new Map<string, Set<string>>();
        for (const r of rows) {
          const key = `${r.matchId}:${r.eventId}`;
          const set = next.get(key) ?? new Set<string>();
          set.add(r.labelId);
          next.set(key, set);
        }
        setClipAssignments(next);
      })
      .catch((e) => console.error("listAssignmentsForClips:", e));
  }, [activeOrgId, selected]);

  // -------------------------------------------------------------------------
  // Label handlers — vocabulary mgmt + per-clip and bulk assignment
  // -------------------------------------------------------------------------
  const setClipAssignmentLocal = useCallback(
    (matchId: string, eventId: number, mutator: (s: Set<string>) => Set<string>) => {
      const key = `${matchId}:${eventId}`;
      setClipAssignments((prev) => {
        const next = new Map(prev);
        const current = next.get(key) ?? new Set<string>();
        next.set(key, mutator(new Set(current)));
        return next;
      });
    },
    [],
  );

  const handleToggleClipLabel = useCallback(
    async (matchId: string, eventId: number, labelId: string, state: LabelTriState) => {
      if (!activeOrgId || !selected) return;
      // 'all' -> remove, 'some'/'none' -> add (Trello union semantics)
      const nextAssigned = state === "all" ? false : true;
      // Optimistic update
      setClipAssignmentLocal(matchId, eventId, (s) => {
        if (nextAssigned) s.add(labelId); else s.delete(labelId);
        return s;
      });
      try {
        const existing = clipAssignments.get(`${matchId}:${eventId}`) ?? new Set<string>();
        const wanted = new Set(existing);
        if (nextAssigned) wanted.add(labelId); else wanted.delete(labelId);
        await apiSetClipAssignments(activeOrgId, matchId, eventId, Array.from(wanted), selected.id);
      } catch (e) {
        console.error("toggle clip label:", e);
        toast.error("Failed to update label");
      }
    },
    [activeOrgId, clipAssignments, setClipAssignmentLocal, selected],
  );

  const handleCreateLabel = useCallback(
    async (name: string, color: LabelColor): Promise<Label> => {
      if (!activeOrgId) throw new Error("No active org");
      const created = await apiCreateLabel(activeOrgId, name, color);
      setLabels((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    },
    [activeOrgId],
  );

  const handleRenameLabel = useCallback(async (id: string, name: string) => {
    await apiUpdateLabel(id, { name });
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l))
      .sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  const handleRecolorLabel = useCallback(async (id: string, color: LabelColor) => {
    await apiUpdateLabel(id, { color });
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, color } : l)));
  }, []);

  const handleDeleteLabel = useCallback(async (id: string) => {
    await apiDeleteLabel(id);
    setLabels((prev) => prev.filter((l) => l.id !== id));
    // Strip it from every clip's assignment set so chips disappear instantly.
    setClipAssignments((prev) => {
      const next = new Map<string, Set<string>>();
      for (const [k, set] of prev.entries()) {
        if (set.has(id)) {
          const newSet = new Set(set);
          newSet.delete(id);
          next.set(k, newSet);
        } else {
          next.set(k, set);
        }
      }
      return next;
    });
  }, []);

  const handleSeedDefaultLabels = useCallback(async () => {
    if (!activeOrgId) return;
    await seedDefaultLabels(activeOrgId);
    const rows = await listLabels(activeOrgId);
    setLabels(rows);
  }, [activeOrgId]);

  // Derived: clip keys (only clips, not text cards) currently multi-selected.
  const selectedClipKeyPairs = useMemo<ClipKey[]>(() => {
    const out: ClipKey[] = [];
    for (const key of selectedClipIds) {
      if (key.startsWith("text:")) continue;
      const [matchId, eventIdStr] = key.split(":");
      const eventId = Number(eventIdStr);
      if (matchId && Number.isFinite(eventId)) out.push({ matchId, eventId });
    }
    return out;
  }, [selectedClipIds]);

  // Tri-state per label for the currently selected clips.
  const { bulkAssignedAll, bulkAssignedSome } = useMemo(() => {
    const all = new Set<string>();
    const some = new Set<string>();
    if (selectedClipKeyPairs.length === 0) return { bulkAssignedAll: all, bulkAssignedSome: some };
    const counts = new Map<string, number>();
    for (const { matchId, eventId } of selectedClipKeyPairs) {
      const s = clipAssignments.get(`${matchId}:${eventId}`);
      if (!s) continue;
      for (const id of s) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = selectedClipKeyPairs.length;
    for (const [id, n] of counts.entries()) {
      if (n === total) all.add(id);
      else if (n > 0) some.add(id);
    }
    return { bulkAssignedAll: all, bulkAssignedSome: some };
  }, [selectedClipKeyPairs, clipAssignments]);

  const handleBulkToggleLabel = useCallback(
    async (labelId: string, state: LabelTriState) => {
      if (!activeOrgId || !selected || selectedClipKeyPairs.length === 0) return;
      const mode: "add" | "remove" = state === "all" ? "remove" : "add";
      // Optimistic UI
      setClipAssignments((prev) => {
        const next = new Map(prev);
        for (const { matchId, eventId } of selectedClipKeyPairs) {
          const key = `${matchId}:${eventId}`;
          const set = new Set(next.get(key) ?? []);
          if (mode === "add") set.add(labelId); else set.delete(labelId);
          next.set(key, set);
        }
        return next;
      });
      try {
        await apiBulkAssign(activeOrgId, selectedClipKeyPairs, labelId, mode, selected.id);
      } catch (e) {
        console.error("bulk toggle label:", e);
        toast.error("Failed to apply label");
      }
    },
    [activeOrgId, selectedClipKeyPairs, selected],
  );


  // Build match lookup for cross-match event resolution
  const matchLookup = useMemo(
    () => new Map(matches.map((m) => [m.id, m])),
    [matches]
  );
  const matchLookupRef = useRef(matchLookup);
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  // Determine the primary match for a playlist (first clip item's match)
  function primaryMatchId(pl: Playlist): string | null {
    return pl.items.find(isClipItem)?.matchId ?? null;
  }

  // Initialize activeMatchId when the selected playlist changes; also stop playback
  useEffect(() => {
    handleStop();
    setShowClipBrowser(false);
    const mId = selected ? primaryMatchId(selected) : null;
    setActiveMatchId(mId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // Swap video source whenever activeMatchId changes
  useEffect(() => {
    if (!activeMatchId) { setLocalVideoUrl(null); return; }
    const m = matchLookupRef.current.get(activeMatchId);
    if (!m?.videoUrl) { setLocalVideoUrl(null); return; }
    const url = m.videoUrl;
    setLocalVideoUrl(isLocalPath(url) ? streamFileSrc(url) : url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatchId]);

  // Apply any pending cross-match seek once the new video is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !localVideoUrl || !pendingSeekRef.current) return;
    function handleCanPlay() {
      if (!pendingSeekRef.current) return;
      const { seekTo, clipEnd } = pendingSeekRef.current;
      pendingSeekRef.current = null;
      clipEndRef.current = undefined;
      const targetP = seekTo;
      const endP = clipEnd;
      const videoP = video!;
      function onSeekedPending() {
        if (videoP.currentTime > targetP + 2) { videoP.addEventListener("seeked", onSeekedPending, { once: true }); return; }
        clipEndRef.current = endP;
        videoP.play().catch(() => {});
      }
      videoP.addEventListener("seeked", onSeekedPending, { once: true });
      videoP.currentTime = seekTo;
    }
    video.addEventListener("canplay", handleCanPlay, { once: true });
    return () => video.removeEventListener("canplay", handleCanPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localVideoUrl]);

  // Filter playlists by search
  const filteredPlaylists = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((pl) => {
      if (pl.name.toLowerCase().includes(q)) return true;
      if (pl.folderId) {
        const folder = folders.find((f) => f.id === pl.folderId);
        if (folder?.name.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [playlists, search, folders]);

  const totalPlaylists = playlists.length;

  // Group filtered playlists by folderId
  const byFolder = useMemo(() => {
    const map = new Map<string | null, Playlist[]>();
    for (const pl of filteredPlaylists) {
      const key = pl.folderId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(pl);
    }
    return map;
  }, [filteredPlaylists]);

  // Reset clock sort when the selected playlist changes
  useEffect(() => { setClockSort("none"); }, [selected?.id]);

  // Clear clip selection when active playlist changes
  useEffect(() => { setSelectedClipIds(new Set()); }, [selected?.id]);

  // Click-outside handler for "Add to another playlist" dropdown
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (addToDropdownRef.current && !addToDropdownRef.current.contains(e.target as Node)) {
        setShowAddToDropdown(false);
        setAddToSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Resolve playlist clip items in display order (cross-match aware)
  const playlistEvents = useMemo((): QueueItem[] => {
    if (!selected) return [];
    return selected.items
      .filter(isClipItem)
      .map((clip) => {
        const match = matchLookup.get(clip.matchId);
        const event = match?.events.find((e) => e.eventId === clip.eventId);
        return event ? { event, matchId: clip.matchId } : null;
      })
      .filter((x): x is QueueItem => x !== null);
  }, [selected, matchLookup]);

  const isMultiMatch = useMemo(
    () => new Set(selected?.items.filter(isClipItem).map((c) => c.matchId)).size > 1,
    [selected]
  );

  const hasTextCards = useMemo(
    () => selected?.items.some((i) => i.type === 'text') ?? false,
    [selected]
  );

  // displayItems: ordered mix of QueueItems and PlaylistTextCards
  const displayItems = useMemo((): PlaybackItem[] => {
    if (!selected) return [];
    const items: PlaybackItem[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        const match = matchLookup.get(item.matchId);
        const event = match?.events.find((e) => e.eventId === item.eventId);
        if (event) items.push({ event, matchId: item.matchId });
      } else {
        items.push(item);
      }
    }
    return items;
  }, [selected, matchLookup]);

  // sortedEvents: displayItems optionally sorted by clock (only when no text cards)
  const sortedEvents = useMemo((): PlaybackItem[] => {
    if (hasTextCards || clockSort === "none") return displayItems;
    return [...displayItems].sort((a, b) => {
      if (isTextCard(a) || isTextCard(b)) return 0;
      const aEv = (a as QueueItem).event;
      const bEv = (b as QueueItem).event;
      if (aEv.period !== bEv.period)
        return clockSort === "asc" ? aEv.period - bEv.period : bEv.period - aEv.period;
      const aT = parseGameClock(formatGameClock(aEv.gameClockTime));
      const bT = parseGameClock(formatGameClock(bEv.gameClockTime));
      return clockSort === "asc" ? bT - aT : aT - bT;
    });
  }, [displayItems, clockSort, hasTextCards]);

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  const handleStop = useCallback(() => {
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    setActiveTextCard(null);
    clipEndRef.current = undefined;
    pendingSeekRef.current = null;
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    videoRef.current?.pause();
  }, []);

  function adjustActiveClip(preDelta: number, postDelta: number) {
    if (!selected || activeEventId === null) return;
    const matchId = activeMatchIdRef.current ?? primaryMatchId(selected);
    if (!matchId) return;
    const existingClip = selected.items.filter(isClipItem).find(
      (c) => c.matchId === matchId && c.eventId === activeEventId
    );
    const newPre = Math.max(-preRollRef.current, (existingClip?.preRollOffset ?? 0) + preDelta);
    const newPost = Math.max(-postRollRef.current, (existingClip?.postRollOffset ?? 0) + postDelta);

    const newItems = selected.items.map((c) =>
      isClipItem(c) && c.matchId === matchId && c.eventId === activeEventId
        ? { ...c, preRollOffset: newPre, postRollOffset: newPost }
        : c
    );
    const updatedPlaylist = { ...selected, items: newItems };
    setSelected(updatedPlaylist);
    selectedRef.current = updatedPlaylist;
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updatedPlaylist : p));
    updateClip(selected.id, matchId, activeEventId, { preRollOffset: newPre, postRollOffset: newPost }).catch(() => {});
    const curQueueItem = queueRef.current[queueIdxRef.current];
    if (curQueueItem && !isTextCard(curQueueItem)) {
      seekToItem(curQueueItem as QueueItem, newPre, newPost);
    }
  }

  function saveClipNote(note: string) {
    if (!selected || activeEventId === null) return;
    const queueItem = queueRef.current.find(
      (i): i is QueueItem => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId
    );
    if (!queueItem) return;
    const newItems = selected.items.map((c) =>
      isClipItem(c) && c.matchId === queueItem.matchId && c.eventId === activeEventId
        ? { ...c, note: note.trim() || undefined }
        : c
    );
    const updatedPlaylist = { ...selected, items: newItems };
    setSelected(updatedPlaylist);
    selectedRef.current = updatedPlaylist;
    setPlaylists((prev) => prev.map((p) => (p.id === selected.id ? updatedPlaylist : p)));
    updateClip(selected.id, queueItem.matchId, activeEventId, { note: note.trim() || null }).catch(() => {});
  }

  function handleNoteChange(value: string) {
    setClipNote(value);
    if (clipNoteSaveTimerRef.current) clearTimeout(clipNoteSaveTimerRef.current);
    clipNoteSaveTimerRef.current = setTimeout(() => {
      clipNoteSaveTimerRef.current = null;
      saveClipNote(value);
    }, 600);
  }

  const activeClipOffsets = useMemo(() => {
    if (activeEventId === null) return { pre: 0, post: 0 };
    const matchId = activeMatchId ?? primaryMatchId(selected!);
    const clip = selected?.items.filter(isClipItem).find(
      (c) => c.matchId === matchId && c.eventId === activeEventId
    );
    return { pre: clip?.preRollOffset ?? 0, post: clip?.postRollOffset ?? 0 };
  }, [activeEventId, activeMatchId, selected]);

  // The currently-playing/active clip's identity, or null. Used by the
  // active-clip label strip rendered above the note textarea.
  const activeClipKey = useMemo<ClipKey | null>(() => {
    if (activeEventId === null || !selected) return null;
    const matchId = activeMatchId ?? primaryMatchId(selected);
    if (!matchId) return null;
    return { matchId, eventId: activeEventId };
  }, [activeEventId, activeMatchId, selected]);

  function getClipOffsets(matchId: string, eventId: number) {
    const clip = selectedRef.current?.items.filter(isClipItem).find(
      (c) => c.matchId === matchId && c.eventId === eventId
    );
    return { pre: clip?.preRollOffset ?? 0, post: clip?.postRollOffset ?? 0 };
  }

  const seekToItem = useCallback((
    item: QueueItem,
    preOverride?: number,
    postOverride?: number,
  ) => {
    const sp = matchLookupRef.current.get(item.matchId)?.syncPoint;
    const video = videoRef.current;
    if (!sp || !video) return;
    const videoTime = computeVideoTime(item.event, sp);
    if (videoTime === null) return;
    const { pre, post } = getClipOffsets(item.matchId, item.event.eventId);
    const seekTo = Math.max(0, Math.min(videoTime, videoTime - preRollRef.current - (preOverride ?? pre)));
    const clipEnd = Math.max(videoTime, videoTime + postRollRef.current + (postOverride ?? post));
    clipEndRef.current = undefined;
    video.pause();
    const target2 = seekTo;
    function onSeeked2() {
      if (video!.currentTime > target2 + 2) { video!.addEventListener("seeked", onSeeked2, { once: true }); return; }
      clipEndRef.current = clipEnd;
      video!.play().catch(() => {});
    }
    video.addEventListener("seeked", onSeeked2, { once: true });
    video.currentTime = seekTo;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isQueueActive = activeEventId !== null || activeTextCard !== null;

  const handleReplay = useCallback(() => {
    const item = queueRef.current[queueIdxRef.current];
    if (item && !isTextCard(item)) seekToItem(item as QueueItem);
  }, [seekToItem]);

  // Shared logic: advance to the next item in the queue after a text card ends.
  // Must be a stable ref to avoid stale closures in setTimeout callbacks.
  function advanceFromTextCard() {
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
    const nextIdx = queueIdxRef.current + 1;
    const queue = queueRef.current;
    if (nextIdx < queue.length) {
      queueIdxRef.current = nextIdx;
      const nextItem = queue[nextIdx];
      if (isTextCard(nextItem)) {
        startTextCardRef.current(nextItem as PlaylistTextCard);
      } else {
        const clipItem = nextItem as QueueItem;
        setActiveEventId(clipItem.event.eventId);
        const sp = matchLookupRef.current.get(clipItem.matchId)?.syncPoint;
        if (sp) {
          const videoTime = computeVideoTime(clipItem.event, sp);
          if (videoTime !== null) {
            const { pre, post } = getClipOffsets(clipItem.matchId, clipItem.event.eventId);
            const seekTo = Math.max(0, videoTime - preRollRef.current - pre);
            const clipEnd = Math.max(videoTime, videoTime + postRollRef.current + post);
            if (clipItem.matchId !== activeMatchIdRef.current) {
              pendingSeekRef.current = { seekTo, clipEnd };
              setActiveMatchId(clipItem.matchId);
            } else {
              const video = videoRef.current;
              clipEndRef.current = undefined;
              video?.pause();
              if (video) {
                const target3 = seekTo;
                const end3 = clipEnd;
                function onSeeked3() {
                  if (video!.currentTime > target3 + 2) { video!.addEventListener("seeked", onSeeked3, { once: true }); return; }
                  clipEndRef.current = end3;
                  video!.play().catch(() => {});
                }
                video.addEventListener("seeked", onSeeked3, { once: true });
                video.currentTime = seekTo;
              }
            }
          }
        }
      }
    } else {
      setIsPlaying(false);
      queueRef.current = [];
    }
  }
  const advanceFromTextCardRef = useRef(advanceFromTextCard);
  advanceFromTextCardRef.current = advanceFromTextCard;

  function startTextCard(card: PlaylistTextCard) {
    setActiveEventId(null);
    setActiveTextCard(card);
    activeTextCardRef.current = card;
    videoRef.current?.pause();
    if (textCardTimerRef.current) clearTimeout(textCardTimerRef.current);
    textCardTimerRef.current = setTimeout(() => {
      textCardTimerRef.current = null;
      advanceFromTextCardRef.current();
    }, card.durationSeconds * 1000);
  }
  const startTextCardRef = useRef(startTextCard);
  startTextCardRef.current = startTextCard;

  // Auto-advance via timeupdate — re-binds when video source changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleTimeUpdate() {
      const end = clipEndRef.current;
      if (end === undefined || !video) return;
      if (video.currentTime < end) return;
      // Guard: if we're >60s past clipEnd the video is at a stale position (seek in progress)
      if (video.currentTime > end + 60) return;

      clipEndRef.current = undefined;
      video.pause();
      const nextIdx = queueIdxRef.current + 1;
      const queue = queueRef.current;

      if (nextIdx < queue.length) {
        queueIdxRef.current = nextIdx;
        const nextItem = queue[nextIdx];
        if (isTextCard(nextItem)) {
          video.pause();
          startTextCardRef.current(nextItem as PlaylistTextCard);
        } else {
          const clipItem = nextItem as QueueItem;
          setActiveEventId(clipItem.event.eventId);
          const sp = matchLookupRef.current.get(clipItem.matchId)?.syncPoint;
          if (sp) {
            const videoTime = computeVideoTime(clipItem.event, sp);
            if (videoTime !== null) {
              const { pre: nextPre, post: nextPost } = getClipOffsets(clipItem.matchId, clipItem.event.eventId);
              const seekTo = Math.max(0, videoTime - preRollRef.current - nextPre);
              const clipEnd = Math.max(videoTime, videoTime + postRollRef.current + nextPost);
              if (clipItem.matchId !== activeMatchIdRef.current) {
                pendingSeekRef.current = { seekTo, clipEnd };
                setActiveMatchId(clipItem.matchId);
              } else {
                // clipEndRef was already cleared above — keep it undefined until seeked
                video.pause();
                const target4 = seekTo;
                const end4 = clipEnd;
                function onSeeked4() {
                  if (video!.currentTime > target4 + 2) { video!.addEventListener("seeked", onSeeked4, { once: true }); return; }
                  clipEndRef.current = end4;
                  video!.play().catch(() => {});
                }
                video.addEventListener("seeked", onSeeked4, { once: true });
                video.currentTime = seekTo;
              }
            }
          }
        }
      } else {
        video.pause();
        setIsPlaying(false);
        setActiveEventId(null);
        queueRef.current = [];
      }
    }

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [localVideoUrl]);

  function startQueue(queue: PlaybackItem[]) {
    if (queue.length === 0) return;
    const firstItem = queue[0];
    queueRef.current = queue;
    queueIdxRef.current = 0;
    setIsPlaying(true);
    if (isTextCard(firstItem)) {
      startTextCardRef.current(firstItem as PlaylistTextCard);
      return;
    }
    const clipItem = firstItem as QueueItem;
    const sp = matchLookupRef.current.get(clipItem.matchId)?.syncPoint;
    if (!sp) return;
    // Clear any active text card overlay and its timer
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    setActiveTextCard(null);
    activeTextCardRef.current = null;
    setActiveEventId(clipItem.event.eventId);
    if (clipItem.matchId !== activeMatchIdRef.current) {
      const videoTime = computeVideoTime(clipItem.event, sp);
      if (videoTime !== null) {
        const { pre, post } = getClipOffsets(clipItem.matchId, clipItem.event.eventId);
        const seekTo = Math.max(0, videoTime - preRollRef.current - pre);
        pendingSeekRef.current = { seekTo, clipEnd: videoTime + postRollRef.current + post };
      }
      setActiveMatchId(clipItem.matchId);
    } else {
      seekToItem(clipItem);
    }
  }

  function handleRowClick(item: PlaybackItem) {
    const idx = sortedEvents.findIndex((i) => itemKey(i) === itemKey(item));
    const queue = idx >= 0 ? sortedEvents.slice(idx) : [item];
    startQueue(queue);
  }

  const _sortedEventsRef = useRef(sortedEvents);
  _sortedEventsRef.current = sortedEvents;
  const _activeEventIdRef = useRef(activeEventId);
  _activeEventIdRef.current = activeEventId;
  const _handleRowClickRef = useRef(handleRowClick);
  _handleRowClickRef.current = handleRowClick;
  const _handleReplayRef = useRef(handleReplay);
  _handleReplayRef.current = handleReplay;

  const listPosition = useMemo(() => {
    if (activeTextCard) return sortedEvents.findIndex(i => isTextCard(i) && (i as PlaylistTextCard).id === activeTextCard.id);
    if (activeEventId !== null) return sortedEvents.findIndex(i => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId);
    return -1;
  }, [activeTextCard, activeEventId, sortedEvents]);
  const canPrev = listPosition > 0;
  const canNext = listPosition >= 0 && listPosition < sortedEvents.length - 1;

  const handlePrev = useCallback(() => {
    const items = _sortedEventsRef.current;
    const cur = items.findIndex(i =>
      isTextCard(i) ? (i as PlaylistTextCard).id === activeTextCardRef.current?.id
                     : (i as QueueItem).event.eventId === _activeEventIdRef.current
    );
    if (cur <= 0) return;
    _handleRowClickRef.current(items[cur - 1]);
  }, []);

  const handleNext = useCallback(() => {
    const items = _sortedEventsRef.current;
    const cur = items.findIndex(i =>
      isTextCard(i) ? (i as PlaylistTextCard).id === activeTextCardRef.current?.id
                     : (i as QueueItem).event.eventId === _activeEventIdRef.current
    );
    if (cur === -1 || cur >= items.length - 1) return;
    _handleRowClickRef.current(items[cur + 1]);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "ArrowDown" && e.code !== "ArrowUp" && e.code !== "ArrowLeft") return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      if (e.code === "ArrowLeft") { _handleReplayRef.current(); return; }
      const items = _sortedEventsRef.current;
      if (items.length === 0) return;
      const cur = items.findIndex(i =>
        isTextCard(i) ? (i as PlaylistTextCard).id === activeTextCardRef.current?.id
                       : (i as QueueItem).event.eventId === _activeEventIdRef.current
      );
      const next = e.code === "ArrowDown"
        ? cur === -1 ? 0 : Math.min(cur + 1, items.length - 1)
        : cur === -1 ? items.length - 1 : Math.max(cur - 1, 0);
      if (next !== cur || cur === -1) _handleRowClickRef.current(items[next]);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (activeEventId === null) return;
    document.querySelector(`[data-event-id="${activeEventId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeEventId]);

  useEffect(() => {
    if (!newlyInsertedCardId) return;
    document.querySelector(`[data-text-card-id="${newlyInsertedCardId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setNewlyInsertedCardId(null);
  }, [newlyInsertedCardId, sortedEvents]);

  async function handleReorder(newDisplayItems: PlaybackItem[]) {
    if (!selected) return;
    // Map display items back to PlaylistItems, preserving all original fields.
    const clipMap = new Map(
      selected.items.filter(isClipItem).map((c) => [`${c.matchId}:${c.eventId}`, c])
    );
    const textCardMap = new Map(
      selected.items.filter((i) => !isClipItem(i)).map((c) => [(c as PlaylistTextCard).id, c as PlaylistTextCard])
    );
    const newItems: PlaylistItem[] = newDisplayItems.map((item) => {
      if (isTextCard(item)) return textCardMap.get((item as PlaylistTextCard).id) ?? item as PlaylistTextCard;
      const qi = item as QueueItem;
      return clipMap.get(`${qi.matchId}:${qi.event.eventId}`) ?? { type: 'clip' as const, matchId: qi.matchId, eventId: qi.event.eventId };
    });
    const updatedPlaylist = { ...selected, items: newItems };
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updatedPlaylist : p));
    setSelected(updatedPlaylist);
    await reorderItems(selected.id, newItems);
  }

  // ---------------------------------------------------------------------------
  // Drag handlers (HTML5)
  // ---------------------------------------------------------------------------

  function recalcDragPosition(x: number, y: number) {
    const scrollEl = playlistScrollRef.current;
    if (!scrollEl) return;
    const trs = scrollEl.querySelectorAll('tbody tr');
    for (let i = 0; i < trs.length; i++) {
      const rect = trs[i].getBoundingClientRect();
      if (y >= rect.top && y < rect.bottom) {
        setClipDragOverIndex(i);
        setClipDragOverPosition(y < rect.top + rect.height / 2 ? 'above' : 'below');
        return;
      }
    }
  }

  function handleClipDragStart(e: React.DragEvent, key: string) {
    e.dataTransfer.setData("text/clip", key);
    e.dataTransfer.effectAllowed = "move";
    setClipDragKey(key);

    // Track cursor globally so autoscroll works even when the cursor is over
    // the sidebar (or any non-clip-row area) during the drag.
    function trackCursor(ev: DragEvent) {
      dragCursorRef.current = { x: ev.clientX, y: ev.clientY };
    }
    window.addEventListener("dragover", trackCursor);
    dragCursorListenerRef.current = trackCursor;

    function step() {
      const cursor = dragCursorRef.current;
      if (cursor) {
        const threshold = 80;
        // Autoscroll whichever container the cursor is currently over.
        for (const el of [playlistScrollRef.current, sidebarScrollRef.current]) {
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (cursor.x < r.left || cursor.x > r.right) continue;
          let delta = 0;
          if (cursor.y < r.top + threshold) {
            delta = -10 * (1 - (cursor.y - r.top) / threshold);
          } else if (cursor.y > r.bottom - threshold) {
            delta = 10 * (1 - (r.bottom - cursor.y) / threshold);
          }
          if (delta !== 0) {
            el.scrollBy(0, delta);
            if (el === playlistScrollRef.current) recalcDragPosition(cursor.x, cursor.y);
          }
        }
        // After autoscroll the browser may not re-fire dragover on the newly
        // revealed rows under a stationary cursor, and elementFromPoint can lag
        // the post-scroll layout by a frame. Iterate the data-playlist-id rows
        // and resolve via getBoundingClientRect, which forces a synchronous
        // layout read — always reflects the current scroll position.
        const sidebarEl = sidebarScrollRef.current;
        if (sidebarEl) {
          const r = sidebarEl.getBoundingClientRect();
          if (cursor.x >= r.left && cursor.x <= r.right && cursor.y >= r.top && cursor.y <= r.bottom) {
            let foundId: string | null = null;
            const rows = sidebarEl.querySelectorAll<HTMLElement>("[data-playlist-id]");
            for (let i = 0; i < rows.length; i++) {
              const rr = rows[i].getBoundingClientRect();
              if (cursor.y >= rr.top && cursor.y <= rr.bottom && cursor.x >= rr.left && cursor.x <= rr.right) {
                foundId = rows[i].dataset.playlistId ?? null;
                break;
              }
            }
            if (foundId !== clipDragOverPlaylistIdRef.current) {
              clipDragOverPlaylistIdRef.current = foundId;
              if (clipDragPlaylistOpenTimerRef.current) {
                clearTimeout(clipDragPlaylistOpenTimerRef.current);
                clipDragPlaylistOpenTimerRef.current = null;
              }
              setClipOpenPlaylistId(null);
              setClipDragOverPlaylistId(foundId);
              if (foundId && selectedRef.current?.id !== foundId) {
                const pl = playlistsRef.current.find((p) => p.id === foundId);
                if (pl) {
                  setClipOpenPlaylistId(foundId);
                  clipDragPlaylistOpenTimerRef.current = setTimeout(() => {
                    clipDragPlaylistOpenTimerRef.current = null;
                    setClipOpenPlaylistId(null);
                    selectPlaylist(pl);
                  }, 600);
                }
              }
            }
          }
        }
      }
      dragScrollRAFRef.current = requestAnimationFrame(step);
    }
    dragScrollRAFRef.current = requestAnimationFrame(step);
  }

  function handleClipDragOver(e: React.DragEvent, index: number) {
    if (!e.dataTransfer.types.includes("text/clip")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    dragCursorRef.current = { x: e.clientX, y: e.clientY };
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
    setClipDragOverIndex(index);
    setClipDragOverPosition(position);
  }

  function handleClipDragEnd() {
    if (dragScrollRAFRef.current !== null) {
      cancelAnimationFrame(dragScrollRAFRef.current);
      dragScrollRAFRef.current = null;
    }
    if (dragCursorListenerRef.current) {
      window.removeEventListener("dragover", dragCursorListenerRef.current);
      dragCursorListenerRef.current = null;
    }
    dragCursorRef.current = null;
    clipDragOverPlaylistIdRef.current = null;
    setClipDragKey(null);
    setClipDragOverIndex(null);
    setClipDragOverPlaylistId(null);
    setClipExpandFolderId(null);
    setClipOpenPlaylistId(null);
    if (clipDragFolderExpandTimerRef.current) {
      clearTimeout(clipDragFolderExpandTimerRef.current);
      clipDragFolderExpandTimerRef.current = null;
    }
    if (clipDragPlaylistOpenTimerRef.current) {
      clearTimeout(clipDragPlaylistOpenTimerRef.current);
      clipDragPlaylistOpenTimerRef.current = null;
    }
  }

  function handleClipDrop(e: React.DragEvent, targetIndex: number) {
    e.preventDefault();
    const key = e.dataTransfer.getData("text/clip");
    if (!key || !selected) return;
    setClipDragOverIndex(null);
    const sourceIndex = sortedEvents.findIndex((i) => itemKey(i) === key);
    const insertIndex = clipDragOverPosition === "above" ? targetIndex : targetIndex + 1;

    // Cross-playlist drop: the dragged clip didn't originate in the current
    // playlist (e.g. user spring-loaded into a different playlist mid-drag).
    if (sourceIndex === -1) {
      if (key.startsWith("text:")) return; // text cards don't migrate
      const colonIdx = key.indexOf(":");
      const matchId = key.slice(0, colonIdx);
      const eventId = Number(key.slice(colonIdx + 1));
      if (selected.items.filter(isClipItem).some((c) => c.matchId === matchId && c.eventId === eventId)) return;
      // Map insertIndex (sortedEvents space) → items space.
      let itemsInsertIndex: number;
      if (insertIndex >= sortedEvents.length) {
        itemsInsertIndex = selected.items.length;
      } else {
        const targetItem = sortedEvents[insertIndex];
        const targetK = itemKey(targetItem);
        const itemsIdx = selected.items.findIndex((i) => {
          const k = i.type === "text" ? `text:${(i as PlaylistTextCard).id}` : `${(i as PlaylistClipItem).matchId}:${(i as PlaylistClipItem).eventId}`;
          return k === targetK;
        });
        itemsInsertIndex = itemsIdx >= 0 ? itemsIdx : selected.items.length;
      }
      const newClip: PlaylistClipItem = { type: "clip", matchId, eventId };
      const newItems = [...selected.items];
      newItems.splice(itemsInsertIndex, 0, newClip);
      const targetId = selected.id;
      addClips(targetId, [newClip], itemsInsertIndex);
      trackEvent("clip_added_to_playlist", { playlist_id: targetId, match_id: matchId });
      setPlaylists((prev) => prev.map((p) => p.id === targetId ? { ...p, items: newItems } : p));
      setSelected((prev) => prev ? { ...prev, items: newItems } : prev);
      handleClipDragEnd();
      return;
    }

    // Same-playlist reorder.
    if (sourceIndex === targetIndex) {
      handleClipDragEnd();
      return;
    }
    const adjusted = insertIndex > sourceIndex ? insertIndex - 1 : insertIndex;
    const next = [...sortedEvents];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(adjusted, 0, moved);
    handleReorder(next);
    handleClipDragEnd();
  }

  async function handleClipDropOnPlaylist(targetPlaylistId: string, clipKey: string) {
    // Text cards can't be dropped onto other playlists
    if (clipKey.startsWith("text:")) return;
    const colonIdx = clipKey.indexOf(":");
    const matchId = clipKey.slice(0, colonIdx);
    const eventId = Number(clipKey.slice(colonIdx + 1));
    const target = playlists.find((p) => p.id === targetPlaylistId);
    if (!target) { handleClipDragEnd(); return; }
    if (target.items.filter(isClipItem).some((c) => c.matchId === matchId && c.eventId === eventId)) {
      handleClipDragEnd();
      return;
    }
    const sourceClip: PlaylistClipItem = selected?.items.filter(isClipItem).find((c) => c.matchId === matchId && c.eventId === eventId)
      ?? { type: 'clip', matchId, eventId };
    const newItems = [...target.items, sourceClip];
    // Synchronously end the drag bookkeeping before the await — guarantees the
    // RAF/window listener can't keep firing while we await the network call,
    // even if dragend never reaches the (possibly unmounted) source row.
    handleClipDragEnd();
    await addClips(targetPlaylistId, [sourceClip], target.items.length);
    trackEvent('clip_added_to_playlist', { playlist_id: targetPlaylistId, match_id: matchId })
    setPlaylists((prev) => prev.map((p) => p.id === targetPlaylistId ? { ...p, items: newItems } : p));
    if (selected?.id === targetPlaylistId) setSelected((prev) => prev ? { ...prev, items: newItems } : prev);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  async function handleExport() {
    if (activeOrgPlan === 'free') {
      setUpgradeDialogOpen(true);
      return;
    }
    setIsExporting(true);
    setExportError(null);
    let segmentCount = 0;
    try {
      const itemsToExport = selectedClipIds.size > 0
        ? sortedEvents.filter(item => selectedClipIds.has(itemKey(item)))
        : sortedEvents;

      const segments = itemsToExport
        .map((item): ExportSegment | null => {
          if (isTextCard(item)) {
            return { kind: 'text', text: (item as PlaylistTextCard).text, durationSeconds: (item as PlaylistTextCard).durationSeconds };
          }
          const qi = item as QueueItem;
          const m = matchLookup.get(qi.matchId);
          if (!m?.videoUrl || !m.syncPoint) return null;
          const clip = selected?.items.filter(isClipItem).find(
            (c) => c.matchId === qi.matchId && c.eventId === qi.event.eventId
          );
          const seg: ExportSegment = {
            kind: 'clip',
            videoPath: m.videoUrl,
            matchId: qi.matchId,
            event: qi.event,
            syncPoint: m.syncPoint,
          };
          if (clip?.preRollOffset !== undefined) (seg as Extract<ExportSegment, { kind: 'clip' }>).preRollOffset = clip.preRollOffset;
          if (clip?.postRollOffset !== undefined) (seg as Extract<ExportSegment, { kind: 'clip' }>).postRollOffset = clip.postRollOffset;
          return seg;
        })
        .filter((x): x is ExportSegment => x !== null);
      segmentCount = segments.filter(s => s.kind === 'clip').length;
      await exportPlaylist(segments, preRoll, postRoll, selected!.name);
      trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'success', selection_only: selectedClipIds.size > 0 });
      // Completes the Getting Started "export a playlist" step (per-device
      // is fine — the checklist is a first-session aid, not a record).
      localStorage.setItem("scoutable_has_exported", "1");
      window.dispatchEvent(new CustomEvent("playlist-exported"));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
      trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'error' });
    } finally {
      setIsExporting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Clip & Ship
  // ---------------------------------------------------------------------------

  async function handleShare(teamIds: string[], userIds: string[]) {
    if (!selected) return;
    setShareDialogOpen(false);
    const prevTeamIds = selected.teamIds ?? [];
    const prevUserIds = selected.userIds ?? [];
    const newlyAddedTeams = teamIds.filter((id) => !prevTeamIds.includes(id));
    const newlyAddedUsers = userIds.filter((id) => !prevUserIds.includes(id));

    // Persist share rows
    await Promise.all([
      setPlaylistTeams(selected.id, teamIds),
      setPlaylistUsers(selected.id, userIds),
    ]);
    const updated = { ...selected, teamIds, teamId: teamIds[0], userIds };
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));
    setSelected(updated);

    // Clip & ship only when new recipients were added
    const newlyAdded = [...newlyAddedTeams, ...newlyAddedUsers];
    if (newlyAdded.length === 0) return;

    setIsShipping(true);
    setShipProgress(null);
    try {
      const segments = sortedEvents
        .map((item): ExportSegment | null => {
          if (isTextCard(item)) return null;
          const qi = item as QueueItem;
          const m = matchLookup.get(qi.matchId);
          if (!m?.videoUrl || !m.syncPoint) return null;
          const clip = updated.items.filter(isClipItem).find(
            (c) => c.matchId === qi.matchId && c.eventId === qi.event.eventId
          );
          const seg: ExportSegment = {
            kind: "clip",
            videoPath: m.videoUrl,
            matchId: qi.matchId,
            event: qi.event,
            syncPoint: m.syncPoint,
          };
          if (clip?.preRollOffset !== undefined)
            (seg as Extract<ExportSegment, { kind: "clip" }>).preRollOffset = clip.preRollOffset;
          if (clip?.postRollOffset !== undefined)
            (seg as Extract<ExportSegment, { kind: "clip" }>).postRollOffset = clip.postRollOffset;
          return seg;
        })
        .filter((x): x is ExportSegment => x !== null);

      await clipAndShip(updated, segments, preRoll, postRoll, (done, total) => {
        setShipProgress({ done, total });
      });

      const teamNames = newlyAddedTeams
        .map((id) => userTeams.find((t) => t.id === id)?.name ?? "team");
      const userNames = newlyAddedUsers
        .map((id) => shareableMembers.find((m) => m.id === id)?.fullName ?? "member");
      const allNames = [...teamNames, ...userNames].join(", ");
      toast.success("Clips shared", {
        description: `${segments.filter((s) => s.kind === "clip").length} clip(s) shared with ${allNames}.`,
      });
      trackEvent("playlist_shipped", { playlist_id: updated.id, clip_count: segments.filter((s) => s.kind === "clip").length });
    } catch (e) {
      toast.error("Share failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsShipping(false);
      setShipProgress(null);
    }
  }

  async function handleShip() {
    if (!selected) return;
    setIsShipping(true);
    setShipProgress(null);
    try {
      const segments = sortedEvents
        .map((item): ExportSegment | null => {
          if (isTextCard(item)) return null;
          const qi = item as QueueItem;
          const m = matchLookup.get(qi.matchId);
          if (!m?.videoUrl || !m.syncPoint) return null;
          const clip = selected.items.filter(isClipItem).find(
            (c) => c.matchId === qi.matchId && c.eventId === qi.event.eventId
          );
          const seg: ExportSegment = {
            kind: "clip",
            videoPath: m.videoUrl,
            matchId: qi.matchId,
            event: qi.event,
            syncPoint: m.syncPoint,
          };
          if (clip?.preRollOffset !== undefined)
            (seg as Extract<ExportSegment, { kind: "clip" }>).preRollOffset = clip.preRollOffset;
          if (clip?.postRollOffset !== undefined)
            (seg as Extract<ExportSegment, { kind: "clip" }>).postRollOffset = clip.postRollOffset;
          return seg;
        })
        .filter((x): x is ExportSegment => x !== null);

      await clipAndShip(selected, segments, preRoll, postRoll, (done, total) => {
        setShipProgress({ done, total });
      });

      toast.success("Clips uploaded", {
        description: `${segments.filter((s) => s.kind === "clip").length} clip(s) are now in the cloud.`,
      });
      trackEvent("playlist_shipped", { playlist_id: selected.id, clip_count: segments.filter((s) => s.kind === "clip").length });
    } catch (e) {
      toast.error("Clip & Ship failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsShipping(false);
      setShipProgress(null);
    }
  }

  // handleShare is defined above (replaces handleShareToTeam / handleShareWithTeams)

  // ---------------------------------------------------------------------------
  // Sidebar helpers
  // ---------------------------------------------------------------------------

  function toggleFolder(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectPlaylist(pl: Playlist) {
    if (selected?.id === pl.id) return;
    setSelected(pl);
    setShowClipBrowser(false);
  }

  // ---------------------------------------------------------------------------
  // Folder operations
  // ---------------------------------------------------------------------------

  function handleNewFolder() {
    const tempId = `temp-${Date.now()}`;
    setPendingNewFolderId(tempId);
    setFolders((prev) => [...prev, { id: tempId, name: "New Folder", sortOrder: 0 }]);
    setExpandedFolders((prev) => new Set([...prev, tempId]));
    setEditingFolderId(tempId);
    setEditFolderName("New Folder");
  }

  async function handleRenameFolder(id: string) {
    const name = editFolderName.trim();

    if (id === pendingNewFolderId) {
      setPendingNewFolderId(null);
      setEditingFolderId(null);
      if (!name) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); return s; });
        return;
      }
      try {
        const folder = await createFolder(name);
        setFolders((prev) => prev.map((f) => f.id === id ? folder : f));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); s.add(folder.id); return s; });
      } catch (err) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); return s; });
        console.error("Failed to create folder:", err);
        alert(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (!name) { setEditingFolderId(null); return; }
    await updateFolder(id, { name });
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name } : f));
    setEditingFolderId(null);
  }

  async function handleDeleteFolder(folderId: string) {
    // Move playlists in this folder to Uncategorized (DB handles ON DELETE SET NULL)
    // Update local state optimistically
    setPlaylists((prev) => prev.map((p) =>
      p.folderId === folderId ? { ...p, folderId: undefined } : p
    ));
    await deleteFolder(folderId);
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
  }

  function handleDragStart(playlistId: string, e: React.DragEvent) {
    e.dataTransfer.setData("text/playlist-id", playlistId);
  }

  async function handleDrop(targetFolderId: string | null, e: React.DragEvent) {
    e.preventDefault();
    setDragOverFolder(null);
    const playlistId = e.dataTransfer.getData("text/playlist-id");
    if (!playlistId) return;
    await updatePlaylist(playlistId, { folderId: targetFolderId });
    setPlaylists((prev) => prev.map((p) =>
      p.id === playlistId ? { ...p, folderId: targetFolderId ?? undefined } : p
    ));
    if (selected?.id === playlistId) {
      setSelected((prev) => prev ? { ...prev, folderId: targetFolderId ?? undefined } : prev);
    }
  }

  // ---------------------------------------------------------------------------
  // Playlist rename / delete
  // ---------------------------------------------------------------------------

  async function handleRenamePlaylist(playlistId: string) {
    const name = editPlaylistName.trim();
    setEditingPlaylistId(null);

    if (playlistId === pendingNewPlaylistId) {
      setPendingNewPlaylistId(null);
      if (!name) {
        setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
        return;
      }
      const folderId = playlists.find((p) => p.id === playlistId)?.folderId;
      try {
        const created = await createPlaylist(name, folderId);
        trackEvent('playlist_created', { playlist_id: created.id, in_folder: !!folderId })
        setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? created : p)));
        selectPlaylist(created);
      } catch (err) {
        console.error("[playlists] Failed to create playlist:", err);
        setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
      }
      return;
    }

    // Normal rename path
    if (!name) return;
    await updatePlaylist(playlistId, { name });
    setPlaylists((prev) => prev.map((p) => p.id === playlistId ? { ...p, name } : p));
    if (selected?.id === playlistId) {
      setSelected((prev) => prev ? { ...prev, name } : prev);
    }
  }

  async function handleDeletePlaylist(playlistId: string) {
    await deletePlaylist(playlistId);
    setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
    if (selected?.id === playlistId) setSelected(null);
  }

  // ---------------------------------------------------------------------------
  // New Playlist inline creation
  // ---------------------------------------------------------------------------

  function handleNewPlaylist() {
    if (browserPanelRef.current?.isCollapsed()) browserPanelRef.current.expand();
    const tempId = `temp-${Date.now()}`;
    const folderId = selected?.folderId;
    const tempPlaylist: Playlist = { id: tempId, name: "New Playlist", items: [], folderId };
    setPendingNewPlaylistId(tempId);
    setPlaylists((prev) => [tempPlaylist, ...prev]);
    if (folderId) {
      setExpandedFolders((prev) => new Set([...prev, folderId]));
    } else {
      setUncategorizedExpanded(true);
    }
    setEditingPlaylistId(tempId);
    setEditPlaylistName("New Playlist");
  }

  // ---------------------------------------------------------------------------
  // Add clips from clip browser
  // ---------------------------------------------------------------------------

  async function handleAddClips(newClips: PlaylistClipItem[]) {
    if (!selected || newClips.length === 0) return;
    const updatedItems = [...selected.items, ...newClips];
    const updatedPlaylist = { ...selected, items: updatedItems };
    setSelected(updatedPlaylist);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updatedPlaylist : p));
    await addClips(selected.id, newClips, selected.items.length);
    newClips.forEach((clip) => {
      trackEvent('clip_added_to_playlist', { playlist_id: selected.id, match_id: clip.matchId })
    })
  }

  // ---------------------------------------------------------------------------
  // Clip selection helpers
  // ---------------------------------------------------------------------------

  const allSelected =
    sortedEvents.length > 0 &&
    sortedEvents.every((item) => selectedClipIds.has(itemKey(item)));

  function toggleSelectClip(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedClipIds(new Set());
    } else {
      setSelectedClipIds(new Set(sortedEvents.map(itemKey)));
    }
  }

  async function handleRemoveSelected() {
    if (!selected) return;
    const newItems = selected.items.filter((c) => {
      const k = isClipItem(c) ? `${c.matchId}:${c.eventId}` : `text:${(c as PlaylistTextCard).id}`;
      return !selectedClipIds.has(k);
    });
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));
    const clipKeysToRemove = selected.items.filter(isClipItem)
      .filter((c) => selectedClipIds.has(`${c.matchId}:${c.eventId}`))
      .map((c) => ({ matchId: c.matchId, eventId: c.eventId }));
    const textCardIdsToRemove = selected.items.filter((i) => !isClipItem(i))
      .filter((c) => selectedClipIds.has(`text:${(c as PlaylistTextCard).id}`))
      .map((c) => (c as PlaylistTextCard).id);
    await removeClips(selected.id, clipKeysToRemove, textCardIdsToRemove);
    setSelectedClipIds(new Set());
  }

  function handleRemoveSingleClip(item: PlaylistClipItem) {
    if (!selected) return;
    const idx = selected.items.indexOf(item);
    const newItems = selected.items.filter((_, i) => i !== idx);
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));

    let undone = false;
    toast('Clip removed', {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          const restored = { ...updated, items: [...newItems.slice(0, idx), item, ...newItems.slice(idx)] };
          setSelected(restored);
          setPlaylists((prev) => prev.map((p) => p.id === selected.id ? restored : p));
        },
      },
      onAutoClose: () => { if (!undone) removeClips(selected.id, [{ matchId: item.matchId, eventId: item.eventId }], []); },
      onDismiss: () => { if (!undone) removeClips(selected.id, [{ matchId: item.matchId, eventId: item.eventId }], []); },
    });
  }

  function handleRemoveSingleTextCard(card: PlaylistTextCard) {
    if (!selected) return;
    const idx = selected.items.indexOf(card);
    const newItems = selected.items.filter((_, i) => i !== idx);
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));

    let undone = false;
    toast('Text card removed', {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          const restored = { ...updated, items: [...newItems.slice(0, idx), card, ...newItems.slice(idx)] };
          setSelected(restored);
          setPlaylists((prev) => prev.map((p) => p.id === selected.id ? restored : p));
        },
      },
      onAutoClose: () => { if (!undone) removeClips(selected.id, [], [card.id]); },
      onDismiss: () => { if (!undone) removeClips(selected.id, [], [card.id]); },
    });
  }

  async function handleAddSelectedToPlaylist(target: Playlist) {
    if (!selected) return;
    const existingSet = new Set(target.items.filter(isClipItem).map((c) => `${c.matchId}:${c.eventId}`));
    const toAdd: PlaylistClipItem[] = sortedEvents
      .filter((item): item is QueueItem => {
        if (isTextCard(item)) return false;
        const key = `${(item as QueueItem).matchId}:${(item as QueueItem).event.eventId}`;
        return selectedClipIds.has(key) && !existingSet.has(key);
      })
      .map((item) =>
        selected.items.filter(isClipItem).find((c) => c.matchId === item.matchId && c.eventId === item.event.eventId)
        ?? { type: 'clip' as const, matchId: item.matchId, eventId: item.event.eventId }
      );
    const newItems = [...target.items, ...toAdd];
    await addClips(target.id, toAdd, target.items.length);
    toAdd.forEach((clip) => {
      trackEvent('clip_added_to_playlist', { playlist_id: target.id, match_id: clip.matchId })
    })
    setPlaylists((prev) => prev.map((p) => p.id === target.id ? { ...p, items: newItems } : p));
    setSelectedClipIds(new Set());
    setShowAddToDropdown(false);
    setAddToSearch("");
  }

  // ---------------------------------------------------------------------------
  // Text card operations
  // ---------------------------------------------------------------------------

  async function handleInsertTextCard(insertAboveIndex: number) {
    if (!selected) return;
    const newCard: PlaylistTextCard = {
      type: 'text',
      id: crypto.randomUUID(),
      text: '',
      durationSeconds: 5,
    };
    // Find the target item in selected.items that corresponds to displayItems[insertAboveIndex]
    const targetDisplayItem = sortedEvents[insertAboveIndex];
    const targetKey = targetDisplayItem ? itemKey(targetDisplayItem) : null;
    const insertAt = targetKey
      ? selected.items.findIndex((item) =>
          isClipItem(item)
            ? `${item.matchId}:${item.eventId}` === targetKey
            : `text:${(item as PlaylistTextCard).id}` === targetKey
        )
      : selected.items.length;
    const finalInsertAt = insertAt >= 0 ? insertAt : selected.items.length;
    const newItems: PlaylistItem[] = [
      ...selected.items.slice(0, finalInsertAt),
      newCard,
      ...selected.items.slice(finalInsertAt),
    ];
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setNewlyInsertedCardId(newCard.id);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));
    await insertTextCard(selected.id, newCard.id, '', 5, finalInsertAt);
    await reorderItems(selected.id, newItems);
  }

  function handleTextCardTextChange(id: string, text: string) {
    if (!selected) return;
    const newItems = selected.items.map((c) =>
      !isClipItem(c) && (c as PlaylistTextCard).id === id ? { ...c, text } : c
    );
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));
  }

  function handleTextCardTextSave(id: string, text: string) {
    if (!selected) return;
    updateTextCard(selected.id, id, { text }).catch(() => {});
  }

  function handleTextCardDurationChange(id: string, durationSeconds: number) {
    if (!selected) return;
    const newItems = selected.items.map((c) =>
      !isClipItem(c) && (c as PlaylistTextCard).id === id ? { ...c, durationSeconds } : c
    );
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));
    updateTextCard(selected.id, id, { durationSeconds }).catch(() => {});
  }

  // ---------------------------------------------------------------------------

  const hasAnyClips = sortedEvents.some((i) => !isTextCard(i));
  const noSync = selected !== null && hasAnyClips && !matchLookup.get(primaryMatchId(selected) ?? "")?.syncPoint;
  const noVideo = selected !== null && !matchLookup.get(primaryMatchId(selected) ?? "")?.videoUrl;

  // Free users must stay able to CLICK export — the click is what opens the
  // UpgradeDialog. Mechanical blockers (demo game, missing video/sync) only
  // disable the button for paid users, who could otherwise actually export.
  const exportLocked = activeOrgPlan === 'free';
  const playlistEmpty = !selected || sortedEvents.length === 0;

  const exportDisabledReason = (() => {
    if (!selected || sortedEvents.length === 0) return "Playlist is empty";
    const involvedMatchIds = new Set(
      sortedEvents.filter((i) => !isTextCard(i)).map((i) => (i as QueueItem).matchId)
    );
    for (const mId of involvedMatchIds) {
      const m = matchLookup.get(mId);
      if (m?.isDemo)
        return "The sample game can't be exported — import your own game to export";
      if (!m?.videoUrl || !isLocalPath(m.videoUrl))
        return "All games need a local video file for export";
      if (!m.syncPoint)
        return "All games need a sync point for export";
    }
    return null;
  })();

  // ---------------------------------------------------------------------------
  // Browser panel toggle (dispatched by sidebar when already on /playlists)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = () => {
      const panel = browserPanelRef.current;
      if (!panel) return;
      panel.isCollapsed() ? panel.expand() : panel.collapse();
    };
    window.addEventListener("playlist-browser-toggle", handler);
    return () => window.removeEventListener("playlist-browser-toggle", handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!profileLoading && !canAccess) return null;

  return (
    <>
    <ResizablePanelGroup direction="horizontal" autoSaveId="playlists-browser" className="h-full">
      {/* LEFT PANEL — playlist sidebar */}
      <ResizablePanel
        panelRef={browserPanelRef}
        defaultSize={22}
        minSize={15}
        collapsible
        collapsedSize={0}
        className="flex flex-col border-r border-border bg-card"
      >
        <div ref={sidebarScrollRef} className="flex flex-1 flex-col overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-card px-3 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Playlists</span>
            {totalPlaylists > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {totalPlaylists}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={handleNewPlaylist}
                    >
                      <ListPlus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New Playlist</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={handleNewFolder}
                    >
                      <FolderPlus className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New Folder</TooltipContent>
                </Tooltip>
              </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search playlists…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-full rounded-md border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-8 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : playlists.length === 0 && folders.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <ListVideo className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">No playlists yet</p>
            <p className="text-xs text-muted-foreground/70">
              Give it a name and add clips from your games.
            </p>
            <Button size="sm" variant="outline" className="mt-2 text-xs" onClick={handleNewPlaylist}>
                New playlist
              </Button>
          </div>
        ) : search.trim() && filteredPlaylists.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Search className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No matches for "{search}"</p>
          </div>
        ) : (
          <div className="py-2">
            {/* Named folders */}
            {folders.map((folder) => {
              const items = byFolder.get(folder.id) ?? [];
              if (search.trim() && items.length === 0) return null;
              const isExpanded = search.trim() ? true : expandedFolders.has(folder.id);
              const isEditing = editingFolderId === folder.id;
              const isDragOver = dragOverFolder === folder.id;
              return (
                <div
                  key={folder.id}
                  className={isDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary rounded-sm" : clipExpandFolderId === folder.id ? "bg-primary/10 rounded-sm" : ""}
                  onDragEnter={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) return;
                    e.preventDefault();
                    setDragOverFolder(folder.id);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) {
                      // Auto-expand collapsed folder: start timer once on first dragOver
                      if (!expandedFolders.has(folder.id) && clipDragFolderExpandTimerRef.current === null) {
                        setClipExpandFolderId(folder.id);
                        clipDragFolderExpandTimerRef.current = setTimeout(() => {
                          clipDragFolderExpandTimerRef.current = null;
                          setClipExpandFolderId(null);
                          setExpandedFolders((prev) => new Set([...prev, folder.id]));
                        }, 600);
                      }
                      return;
                    }
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverFolder(folder.id);
                  }}
                  onDragLeave={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setClipExpandFolderId(null);
                        if (clipDragFolderExpandTimerRef.current) {
                          clearTimeout(clipDragFolderExpandTimerRef.current);
                          clipDragFolderExpandTimerRef.current = null;
                        }
                      }
                      return;
                    }
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null);
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) return;
                    handleDrop(folder.id, e);
                  }}
                >
                  {/* Folder header */}
                  <div
                    className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none transition-colors ${
                      isDragOver ? "" : "hover:bg-muted/50"
                    }`}
                    onClick={() => !isEditing && toggleFolder(folder.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-colors ${clipExpandFolderId === folder.id ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
                    )}
                    {isEditing ? (
                      <input
                        autoFocus
                        className="flex-1 min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => handleRenameFolder(folder.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameFolder(folder.id);
                          if (e.key === "Escape") {
                            if (folder.id === pendingNewFolderId) {
                              setPendingNewFolderId(null);
                              setFolders((prev) => prev.filter((f) => f.id !== folder.id));
                              setExpandedFolders((prev) => { const s = new Set(prev); s.delete(folder.id); return s; });
                            }
                            setEditingFolderId(null);
                          }
                        }}
                      />
                    ) : (
                      <span
                        className="flex-1 min-w-0 truncate text-sm font-semibold text-foreground/80"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingFolderId(folder.id);
                          setEditFolderName(folder.name);
                        }}
                      >
                        {folder.name}
                      </span>
                    )}
                    {!isEditing ? (
                      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                        <span className={`text-xs font-semibold text-muted-foreground ${openMenuFolderId === folder.id ? "hidden" : "group-hover:hidden"}`}>{items.length}</span>
                        <DropdownMenu
                          open={openMenuFolderId === folder.id}
                          onOpenChange={(open) => setOpenMenuFolderId(open ? folder.id : null)}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className={`rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none ${openMenuFolderId === folder.id ? "flex" : "hidden group-hover:flex"}`}
                            >
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }}>
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => handleDeleteFolder(folder.id)}
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">{items.length}</span>
                    )}
                  </div>

                  {/* Folder playlists */}
                  {isExpanded && (
                    <div className="pb-1">
                      {items.length === 0 ? (
                        <p className="pl-10 py-1.5 text-xs text-muted-foreground/60">
                          Empty — drag a playlist here
                        </p>
                      ) : (
                        items.map((pl) => {
                          const isActive = selected?.id === pl.id;
                          const isEditingThis = editingPlaylistId === pl.id;
                          return (
                            <ContextMenu key={pl.id}>
                              <ContextMenuTrigger asChild>
                                <div
                                  data-playlist-id={pl.id}
                                  draggable={!isEditingThis}
                                  onDragStart={(e) => handleDragStart(pl.id, e)}
                                  onDragEnd={() => setDragOverFolder(null)}
                                  onDragOver={(e) => {
                                    if (!e.dataTransfer.types.includes("text/clip")) return;
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = "copy";
                                    if (clipDragOverPlaylistIdRef.current !== pl.id) {
                                      clipDragOverPlaylistIdRef.current = pl.id;
                                      setClipDragOverPlaylistId(pl.id);
                                      // Spring-load: open this playlist after a delay if not already open.
                                      if (selected?.id !== pl.id && clipDragPlaylistOpenTimerRef.current === null) {
                                        setClipOpenPlaylistId(pl.id);
                                        clipDragPlaylistOpenTimerRef.current = setTimeout(() => {
                                          clipDragPlaylistOpenTimerRef.current = null;
                                          setClipOpenPlaylistId(null);
                                          selectPlaylist(pl);
                                        }, 600);
                                      }
                                    }
                                  }}
                                  onDragLeave={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                      clipDragOverPlaylistIdRef.current = null;
                                      setClipDragOverPlaylistId(null);
                                      setClipOpenPlaylistId(null);
                                      if (clipDragPlaylistOpenTimerRef.current) {
                                        clearTimeout(clipDragPlaylistOpenTimerRef.current);
                                        clipDragPlaylistOpenTimerRef.current = null;
                                      }
                                    }
                                  }}
                                  onDrop={(e) => {
                                    const key = e.dataTransfer.getData("text/clip");
                                    if (!key) return;
                                    e.preventDefault();
                                    handleClipDropOnPlaylist(pl.id, key);
                                  }}
                                  className={`group flex w-full cursor-pointer items-center justify-between border-l-2 pl-9 pr-3 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                                    isActive
                                      ? "border-l-primary bg-primary/10"
                                      : "border-l-border hover:border-l-border/80"
                                  } ${clipDragOverPlaylistId === pl.id ? "bg-primary/15 ring-1 ring-inset ring-primary" : ""} ${clipOpenPlaylistId === pl.id ? "animate-pulse" : ""}`}
                                  onClick={() => !isEditingThis && selectPlaylist(pl)}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                    <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab" />
                                    <ListVideo className={`h-3 w-3 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                    {isEditingThis ? (
                                      <input
                                        autoFocus
                                        className="flex-1 min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                                        value={editPlaylistName}
                                        onChange={(e) => setEditPlaylistName(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        onBlur={() => handleRenamePlaylist(pl.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") e.currentTarget.blur();
                                          if (e.key === "Escape") {
                                            if (pl.id === pendingNewPlaylistId) {
                                              setPendingNewPlaylistId(null);
                                              setPlaylists((prev) => prev.filter((p) => p.id !== pl.id));
                                            }
                                            setEditingPlaylistId(null);
                                          }
                                        }}
                                      />
                                    ) : (
                                      <>
                                        {(pl.teamIds?.length ?? 0) > 0 && (
                                          <Users className="h-3 w-3 shrink-0 text-primary/70" />
                                        )}
                                        <span className={`truncate text-sm ${isActive ? "font-medium text-primary" : "text-muted-foreground"}`}>
                                          {pl.name}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <div className="ml-2 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                                    <span className={`text-xs text-muted-foreground ${openMenuPlaylistId === pl.id ? "hidden" : "group-hover:hidden"}`}>
                                      {pl.items.length}
                                    </span>
                                    <DropdownMenu
                                      open={openMenuPlaylistId === pl.id}
                                      onOpenChange={(open) => setOpenMenuPlaylistId(open ? pl.id : null)}
                                    >
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          className={`rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none ${openMenuPlaylistId === pl.id ? "flex" : "hidden group-hover:flex"}`}
                                        >
                                          <MoreHorizontal className="h-3.5 w-3.5" />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <>
                                          <DropdownMenuItem onSelect={() => { setEditingPlaylistId(pl.id); setEditPlaylistName(pl.name); }}>
                                            Rename
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            className="text-destructive focus:text-destructive"
                                            onSelect={() => handleDeletePlaylist(pl.id)}
                                          >
                                            Delete
                                          </DropdownMenuItem>
                                          {userTeams.length > 0 && (
                                            <>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuItem onSelect={() => {
                                                selectPlaylist(pl);
                                                setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                                                setShareDialogOpen(true);
                                              }}>Share…</DropdownMenuItem>
                                            </>
                                          )}
                                        </>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              </ContextMenuTrigger>
                              <ContextMenuContent>
                                <ContextMenuItem onSelect={() => { setEditingPlaylistId(pl.id); setEditPlaylistName(pl.name); }}>
                                  Rename
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => handleDeletePlaylist(pl.id)}
                                >
                                  Delete
                                </ContextMenuItem>
                                {userTeams.length > 0 && (
                                  <>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem onSelect={() => {
                                      selectPlaylist(pl);
                                      setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                                      setShareDialogOpen(true);
                                    }}>Share…</ContextMenuItem>
                                  </>
                                )}
                              </ContextMenuContent>
                            </ContextMenu>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Uncategorized */}
            {(() => {
              const items = byFolder.get(null) ?? [];
              if (items.length === 0 && (folders.length > 0 || search.trim())) return null;
              const isExpanded = search.trim() ? true : uncategorizedExpanded;
              const isDragOver = dragOverFolder === "uncategorized";
              return (
                <div
                  className={isDragOver ? "bg-primary/10 ring-1 ring-inset ring-primary rounded-sm" : clipExpandFolderId === "uncategorized" ? "bg-primary/10 rounded-sm" : ""}
                  onDragEnter={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) return;
                    e.preventDefault();
                    setDragOverFolder("uncategorized");
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) {
                      if (!uncategorizedExpanded && clipDragFolderExpandTimerRef.current === null) {
                        setClipExpandFolderId("uncategorized");
                        clipDragFolderExpandTimerRef.current = setTimeout(() => {
                          clipDragFolderExpandTimerRef.current = null;
                          setClipExpandFolderId(null);
                          setUncategorizedExpanded(true);
                        }, 600);
                      }
                      return;
                    }
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverFolder("uncategorized");
                  }}
                  onDragLeave={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setClipExpandFolderId(null);
                        if (clipDragFolderExpandTimerRef.current) {
                          clearTimeout(clipDragFolderExpandTimerRef.current);
                          clipDragFolderExpandTimerRef.current = null;
                        }
                      }
                      return;
                    }
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null);
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.types.includes("text/clip")) return;
                    handleDrop(null, e);
                  }}
                >
                  <div
                    className={`group flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none transition-colors ${
                      isDragOver ? "" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setUncategorizedExpanded((v) => !v)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-colors ${clipExpandFolderId === "uncategorized" ? "text-primary animate-pulse" : "text-muted-foreground"}`} />
                    )}
                    <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                      Uncategorized
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  {isExpanded && (
                    <div className="pb-1">
                      {items.map((pl) => {
                        const isActive = selected?.id === pl.id;
                        const isEditingThis = editingPlaylistId === pl.id;
                        return (
                          <ContextMenu key={pl.id}>
                            <ContextMenuTrigger asChild>
                              <div
                                data-playlist-id={pl.id}
                                draggable={!isEditingThis}
                                onDragStart={(e) => handleDragStart(pl.id, e)}
                                onDragEnd={() => setDragOverFolder(null)}
                                onDragOver={(e) => {
                                  if (!e.dataTransfer.types.includes("text/clip")) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "copy";
                                  if (clipDragOverPlaylistIdRef.current !== pl.id) {
                                    clipDragOverPlaylistIdRef.current = pl.id;
                                    setClipDragOverPlaylistId(pl.id);
                                    if (selected?.id !== pl.id && clipDragPlaylistOpenTimerRef.current === null) {
                                      setClipOpenPlaylistId(pl.id);
                                      clipDragPlaylistOpenTimerRef.current = setTimeout(() => {
                                        clipDragPlaylistOpenTimerRef.current = null;
                                        setClipOpenPlaylistId(null);
                                        selectPlaylist(pl);
                                      }, 600);
                                    }
                                  }
                                }}
                                onDragLeave={(e) => {
                                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                    clipDragOverPlaylistIdRef.current = null;
                                    setClipDragOverPlaylistId(null);
                                    setClipOpenPlaylistId(null);
                                    if (clipDragPlaylistOpenTimerRef.current) {
                                      clearTimeout(clipDragPlaylistOpenTimerRef.current);
                                      clipDragPlaylistOpenTimerRef.current = null;
                                    }
                                  }
                                }}
                                onDrop={(e) => {
                                  const key = e.dataTransfer.getData("text/clip");
                                  if (!key) return;
                                  e.preventDefault();
                                  handleClipDropOnPlaylist(pl.id, key);
                                }}
                                className={`group flex w-full cursor-pointer items-center justify-between border-l-2 pl-8 pr-3 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                                  isActive
                                    ? "border-l-primary bg-primary/10"
                                    : "border-l-border hover:border-l-border/80"
                                } ${clipDragOverPlaylistId === pl.id ? "bg-primary/15 ring-1 ring-inset ring-primary" : ""} ${clipOpenPlaylistId === pl.id ? "animate-pulse" : ""}`}
                                onClick={() => !isEditingThis && selectPlaylist(pl)}
                              >
                                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                  <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab" />
                                  <ListVideo className={`h-3 w-3 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                                  {isEditingThis ? (
                                    <input
                                      autoFocus
                                      className="flex-1 min-w-0 rounded border border-primary bg-background px-1 py-0.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                                      value={editPlaylistName}
                                      onChange={(e) => setEditPlaylistName(e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      onBlur={() => handleRenamePlaylist(pl.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") e.currentTarget.blur();
                                        if (e.key === "Escape") {
                                          if (pl.id === pendingNewPlaylistId) {
                                            setPendingNewPlaylistId(null);
                                            setPlaylists((prev) => prev.filter((p) => p.id !== pl.id));
                                          }
                                          setEditingPlaylistId(null);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <>
                                      {(pl.teamIds?.length ?? 0) > 0 && (
                                        <Users className="h-3 w-3 shrink-0 text-primary/70" />
                                      )}
                                      <span className={`truncate text-sm ${isActive ? "font-medium text-primary" : "text-muted-foreground"}`}>
                                        {pl.name}
                                      </span>
                                    </>
                                  )}
                                </div>
                                <div className="ml-2 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
                                  <span className={`text-xs text-muted-foreground ${openMenuPlaylistId === pl.id ? "hidden" : "group-hover:hidden"}`}>
                                    {pl.items.length}
                                  </span>
                                  <DropdownMenu
                                    open={openMenuPlaylistId === pl.id}
                                    onOpenChange={(open) => setOpenMenuPlaylistId(open ? pl.id : null)}
                                  >
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className={`rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none ${openMenuPlaylistId === pl.id ? "flex" : "hidden group-hover:flex"}`}
                                      >
                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onSelect={() => { setEditingPlaylistId(pl.id); setEditPlaylistName(pl.name); }}>
                                        Rename
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => handleDeletePlaylist(pl.id)}
                                      >
                                        Delete
                                      </DropdownMenuItem>
                                      {userTeams.length > 0 && (
                                        <>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onSelect={() => {
                                            selectPlaylist(pl);
                                            setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                                            setShareDialogOpen(true);
                                          }}>Share…</DropdownMenuItem>
                                        </>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem onSelect={() => { setEditingPlaylistId(pl.id); setEditPlaylistName(pl.name); }}>
                                Rename
                              </ContextMenuItem>
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => handleDeletePlaylist(pl.id)}
                              >
                                Delete
                              </ContextMenuItem>
                              {userTeams.length > 0 && (
                                <>
                                  <ContextMenuSeparator />
                                  <ContextMenuItem onSelect={() => {
                                    selectPlaylist(pl);
                                    setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                                    setShareDialogOpen(true);
                                  }}>Share…</ContextMenuItem>
                                </>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Shared by me section */}
            {(() => {
              const sharedPlaylists = playlists.filter((p) => (p.teamIds?.length ?? 0) > 0);
              if (sharedPlaylists.length === 0) return null;
              return (
                <div className="mt-1 border-t border-border pt-1">
                  <div
                    className="group flex items-center gap-1.5 px-3 py-2 cursor-pointer select-none transition-colors hover:bg-muted/50"
                    onClick={() => setSharedSectionExpanded((v) => !v)}
                  >
                    {sharedSectionExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
                      Shared by me
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {sharedPlaylists.length}
                    </span>
                  </div>
                  {sharedSectionExpanded && (
                    <div className="pb-1">
                      {sharedPlaylists.map((pl) => {
                        const isActive = selected?.id === pl.id;
                        const teamNames = (pl.teamIds ?? [])
                          .map((id) => userTeams.find((t) => t.id === id)?.name)
                          .filter(Boolean)
                          .join(", ");
                        return (
                          <div
                            key={pl.id}
                            className={`flex w-full cursor-pointer items-center gap-2 border-l-2 pl-8 pr-3 py-1.5 text-left transition-colors hover:bg-muted/50 ${
                              isActive ? "border-l-primary bg-primary/10" : "border-l-border hover:border-l-border/80"
                            }`}
                            onClick={() => selectPlaylist(pl)}
                          >
                            <Users className={`h-3 w-3 shrink-0 ${isActive ? "text-primary" : "text-primary/60"}`} />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className={`truncate text-sm ${isActive ? "font-medium text-primary" : "text-muted-foreground"}`}>
                                {pl.name}
                              </span>
                              {teamNames && (
                                <span className="truncate text-[10px] text-muted-foreground/60">{teamNames}</span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="ml-auto shrink-0 rounded p-0.5 text-primary hover:bg-primary/10 focus:outline-none"
                              title="Manage sharing"
                              onClick={(e) => {
                                e.stopPropagation();
                                selectPlaylist(pl);
                                setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                                setShareDialogOpen(true);
                              }}
                            >
                              <Share2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        {!loading && (
          <div className="sticky bottom-0 z-10 mt-auto border-t border-border bg-card p-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5 text-xs"
              onClick={handleNewPlaylist}
            >
              <ListPlus className="h-3.5 w-3.5" />
              New Playlist
            </Button>
          </div>
        )}
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* RIGHT PANEL — detail */}
      <ResizablePanel defaultSize={78} minSize={40} className="flex flex-col overflow-hidden bg-background">
        {selected === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
            <ListVideo className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              Select a playlist
            </p>
            <p className="text-sm text-muted-foreground/70">
              Choose one from the panel, or create a new playlist to start collecting clips.
            </p>
            <Button size="sm" variant="outline" className="mt-1 text-xs" onClick={handleNewPlaylist}>
                New playlist
              </Button>
          </div>
        ) : (
          <>
          <div className="flex flex-col gap-4 p-5 h-full">
            {/* Playlist header */}
            <div className="flex items-center justify-between flex-none">
              <div className="group flex min-w-0 flex-1 items-start gap-1">
                <div className="flex min-w-0 flex-col">
                  {editingPlaylistId === selected.id ? (
                    <input
                      autoFocus
                      className="rounded border border-primary bg-background px-1 py-0.5 text-base font-semibold text-foreground outline-none focus:ring-1 focus:ring-primary"
                      value={editPlaylistName}
                      onChange={(e) => setEditPlaylistName(e.target.value)}
                      onBlur={() => handleRenamePlaylist(selected.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenamePlaylist(selected.id);
                        if (e.key === "Escape") setEditingPlaylistId(null);
                      }}
                    />
                  ) : (
                    <span className="text-base font-semibold text-foreground truncate">
                      {selected.name}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {selected.items.length} item{selected.items.length !== 1 ? "s" : ""}
                    {isMultiMatch ? " · multiple games" : ""}
                  </span>
                </div>
                {editingPlaylistId !== selected.id && (
                  <>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted"
                      title="Rename playlist"
                      onClick={() => { setEditingPlaylistId(selected.id); setEditPlaylistName(selected.name); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                      title="Delete playlist"
                      onClick={() => handleDeletePlaylist(selected.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
              <div
                className="flex items-center rounded-md border border-border p-0.5 gap-0.5 flex-none"
                role="group"
                aria-label="Layout view"
              >
                <Button
                  variant={!theaterMode ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setTheaterMode(false)}
                  title="Split view"
                  aria-pressed={!theaterMode}
                >
                  <Columns2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant={theaterMode ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => setTheaterMode(true)}
                  title="Theater mode"
                  aria-pressed={theaterMode}
                >
                  <Rows2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Layout: horizontal split (default) or vertical theater mode */}
            {theaterMode ? (
              <ResizablePanelGroup key="theater" direction="vertical" autoSaveId="playlists-theater" className="min-h-0 flex-1">
                <ResizablePanel defaultSize={70} minSize={25}>
                <div className="flex h-full flex-col gap-2 pb-3 min-w-0">
                {localVideoUrl ? (
                  <>
                    <div className="relative">
                      <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                      {activeTextCard && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black transition-opacity duration-200">
                          <p className="text-center text-4xl font-semibold text-white px-8">{activeTextCard.text}</p>
                        </div>
                      )}
                    </div>
                    <VideoClipControls
                      videoRef={videoRef}
                      canPrev={canPrev}
                      canNext={canNext}
                      isQueueActive={isQueueActive}
                      onPrev={handlePrev}
                      onNext={handleNext}
                      onReplay={handleReplay}
                      onStop={handleStop}
                      onPlayAll={() => startQueue(sortedEvents)}
                      activeClipPreOffset={activeClipOffsets.pre}
                      activeClipPostOffset={activeClipOffsets.post}
                      onPreOffsetChange={(delta) => adjustActiveClip(delta, 0)}
                      onPostOffsetChange={(delta) => adjustActiveClip(0, delta)}
                    />
                    {activeClipKey && activeOrgId && (() => {
                      const key = `${activeClipKey.matchId}:${activeClipKey.eventId}`;
                      const assignedIds = clipAssignments.get(key) ?? new Set<string>();
                      const assigned = labels.filter((l) => assignedIds.has(l.id));
                      const playlistName = selected?.name ?? "this playlist";
                      const scopeTitle = `Labels in ${playlistName}`;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 px-1">
                          <LabelPickerPopover
                            trigger={
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
                                title={scopeTitle}
                              >
                                <Tag className="h-3 w-3" />
                                {assigned.length === 0 ? "Add labels" : "Edit"}
                              </button>
                            }
                            labels={labels}
                            assignedAllIds={assignedIds}
                            onToggle={(labelId, state) => handleToggleClipLabel(activeClipKey.matchId, activeClipKey.eventId, labelId, state)}
                            onCreate={handleCreateLabel}
                            onRename={handleRenameLabel}
                            onRecolor={handleRecolorLabel}
                            onDelete={handleDeleteLabel}
                            onSeedDefaults={handleSeedDefaultLabels}
                            align="start"
                            scopeTitle={scopeTitle}
                            scopeHint="Visible only in this playlist"
                          />
                          {assigned.map((l) => <LabelChip key={l.id} label={l} />)}
                        </div>
                      );
                    })()}
                    {activeEventId !== null && (
                      <textarea
                        className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                        rows={3}
                        placeholder="Add a note for this clip…"
                        value={clipNote}
                        onChange={(e) => handleNoteChange(e.target.value)}
                      />
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <VideoPlaceholder />
                    {noVideo && selected.items.filter(isClipItem).length > 0 && (
                      <p className="text-center text-xs text-muted-foreground">
                        No video linked. Add one in the game.
                      </p>
                    )}
                  </div>
                )}
                </div>
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize={30} minSize={20}>
                <div className="flex h-full flex-col gap-3 overflow-hidden pt-3">
                <div className="flex shrink-0 flex-col gap-3">
                {noSync && selected.items.filter(isClipItem).length > 0 && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                    No sync point — set one in the game to enable playback controls.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground">Pre</label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      className="h-7 w-16 text-xs"
                      value={preRoll}
                      onChange={(e) => setPreRoll(Number(e.target.value))}
                    />
                    <label className="text-xs text-muted-foreground">Post</label>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      className="h-7 w-16 text-xs"
                      value={postRoll}
                      onChange={(e) => setPostRoll(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => setShowClipBrowser(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Clips
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => handleInsertTextCard(sortedEvents.length)}
                    >
                      <Type className="h-3.5 w-3.5" />
                      Add Text Card
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPlaying ? (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleStop}>
                        <Square className="h-3.5 w-3.5" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => startQueue(sortedEvents)}
                        disabled={sortedEvents.length === 0 || noSync}
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                        Play Playlist
                      </Button>
                    )}
                    {isExporting ? (
                      <Button size="sm" variant="outline" disabled className="h-8 gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Exporting…
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={handleExport}
                        disabled={exportLocked ? playlistEmpty : !!exportDisabledReason}
                        title={exportLocked
                          ? "Export playlists as MP4 with Rookie or Pro"
                          : (exportDisabledReason ?? "Export playlist as MP4")}
                      >
                        {activeOrgPlan === 'free'
                          ? <Lock className="h-3.5 w-3.5" />
                          : <FileDown className="h-3.5 w-3.5" />
                        }
                        {selectedClipIds.size > 0
                          ? `Export ${selectedClipIds.size} selected`
                          : 'Export Playlist'}
                      </Button>
                    )}
                  </div>
                  {/* Share button — icon-only, colored when shared */}
                  {userTeams.length > 0 && (
                    isShipping ? (
                      <Button size="sm" variant="outline" disabled className="h-8 gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {shipProgress ? `${shipProgress.done} / ${shipProgress.total}` : "Uploading…"}
                      </Button>
                    ) : (() => {
                      const teamCount = selected?.teamIds?.length ?? 0;
                      const userCount = selected?.userIds?.length ?? 0;
                      const isShared = teamCount > 0 || userCount > 0;
                      const teamNames = (selected?.teamIds ?? [])
                        .map((id) => userTeams.find((t) => t.id === id)?.name ?? "Team");
                      const parts: string[] = [];
                      if (teamNames.length > 0) parts.push(teamNames.join(", "));
                      if (userCount > 0) parts.push(`${userCount} member${userCount !== 1 ? "s" : ""}`);
                      const sharedLabel = parts.join(" · ");
                      return (
                        <Button
                          size="sm"
                          variant={isShared ? "default" : "outline"}
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setPendingShareTeamIds(new Set(selected?.teamIds ?? []));
                            setPendingShareUserIds(new Set(selected?.userIds ?? []));
                            setMemberSearchQuery("");
                            setShareDialogOpen(true);
                          }}
                          disabled={!!exportDisabledReason}
                          title={isShared ? `Shared with: ${sharedLabel}` : (exportDisabledReason ?? "Share with team or members")}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                      );
                    })()
                  )}
                  {exportError && (
                    <p className="w-full text-xs text-red-500 mt-1">{exportError}</p>
                  )}
                </div>
                {selectedClipIds.size > 0 && (
                  <div className="flex items-center gap-3 rounded-lg bg-primary/10 px-4 py-2.5">
                    <span className="text-sm font-medium text-primary">
                      {selectedClipIds.size} item{selectedClipIds.size !== 1 ? "s" : ""} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-red-600 px-2 text-xs text-white hover:bg-red-700"
                        onClick={handleRemoveSelected}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove from playlist
                      </Button>
                      {selectedClipKeyPairs.length > 0 && (
                        <LabelPickerPopover
                          trigger={
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
                              <Tag className="h-3.5 w-3.5" />
                              Apply label
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          }
                          labels={labels}
                          assignedAllIds={bulkAssignedAll}
                          assignedSomeIds={bulkAssignedSome}
                          onToggle={handleBulkToggleLabel}
                          onCreate={handleCreateLabel}
                          onRename={handleRenameLabel}
                          onRecolor={handleRecolorLabel}
                          onDelete={handleDeleteLabel}
                          onSeedDefaults={handleSeedDefaultLabels}
                          scopeTitle={`Labels in ${selected?.name ?? "this playlist"}`}
                          scopeHint="Visible only in this playlist"
                        />
                      )}
                      {playlists.filter((p) => p.id !== selected?.id).length > 0 && (
                        <div ref={addToDropdownRef} className="relative">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => { setShowAddToDropdown((v) => !v); setAddToSearch(""); }}
                          >
                            Add to another playlist
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                          {showAddToDropdown && (
                            <AddToDropdown
                              playlists={playlists}
                              activePlaylistId={selected?.id ?? null}
                              addToSearch={addToSearch}
                              setAddToSearch={setAddToSearch}
                              onAddToPlaylist={handleAddSelectedToPlaylist}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                </div>

                <div ref={playlistScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {sortedEvents.length === 0 ? (
                  <div
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes("text/clip")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setClipDragOverIndex(0);
                      setClipDragOverPosition("above");
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setClipDragOverIndex(null);
                    }}
                    onDrop={(e) => handleClipDrop(e, 0)}
                    className={`flex min-h-full flex-col items-center justify-center gap-3 py-12 text-center rounded-lg border-2 border-dashed transition-colors ${
                      clipDragOverIndex === 0 ? "border-primary bg-primary/5" : "border-transparent"
                    }`}
                  >
                    <p className="text-sm text-muted-foreground">
                      This playlist has no clips yet.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setShowClipBrowser(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Clips
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[580px] text-sm">
                      <thead className="border-b border-border bg-muted/80 text-xs font-medium text-muted-foreground">
                        <tr>
                          <th className="w-1.5 min-w-1.5 p-0" aria-hidden />
                          <th className="w-8" />
                          <th className="w-8 px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={toggleSelectAll}
                              className="h-3.5 w-3.5 rounded border-border accent-primary"
                            />
                          </th>
                          <th className="px-4 py-2.5 text-left">Period</th>
                          <th
                            className={`px-4 py-2.5 text-left select-none ${hasTextCards ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:text-foreground"}`}
                            onClick={() => !hasTextCards && setClockSort((s) => s === "none" ? "asc" : s === "asc" ? "desc" : "none")}
                            title={hasTextCards ? "Clock sort is unavailable when text cards are present" : undefined}
                          >
                            <span className="inline-flex items-center gap-1">
                              Clock
                              {!hasTextCards && clockSort === "asc" && <ArrowUp className="h-3 w-3" />}
                              {!hasTextCards && clockSort === "desc" && <ArrowDown className="h-3 w-3" />}
                            </span>
                          </th>
                          {isMultiMatch && <th className="px-4 py-2.5 text-left">Game</th>}
                          <th className="px-4 py-2.5 text-left">Event</th>
                          <th className="px-4 py-2.5 text-left">Player</th>
                          <th className="px-4 py-2.5 text-left">Team</th>
                          <th className="px-4 py-2.5" />
                          <th className="px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {sortedEvents.map((item, index) => {
                          const key = itemKey(item);
                          if (isTextCard(item)) {
                            const card = item as PlaylistTextCard;
                            return (
                              <TextCardRow
                                key={key}
                                card={card}
                                index={index}
                                isActive={activeTextCard?.id === card.id}
                                isSelected={selectedClipIds.has(key)}
                                onSelect={(e) => toggleSelectClip(key, e)}
                                isDragTarget={clipDragOverIndex === index}
                                dragTargetPosition={clipDragOverPosition}
                                onClick={() => handleRowClick(card)}
                                onDragStart={(e) => handleClipDragStart(e, key)}
                                onDragOver={(e, i) => handleClipDragOver(e, i)}
                                onDragLeave={() => setClipDragOverIndex(null)}
                                onDrop={(e, i) => handleClipDrop(e, i)}
                                onDragEnd={handleClipDragEnd}
                                onTextChange={handleTextCardTextChange}
                                onTextSave={handleTextCardTextSave}
                                onDurationChange={handleTextCardDurationChange}
                                onRemove={() => handleRemoveSingleTextCard(card)}
                              />
                            );
                          }
                          const queueItem = item as QueueItem;
                          const clip = selected?.items.filter(isClipItem).find(
                            (c) => c.matchId === queueItem.matchId && c.eventId === queueItem.event.eventId
                          );
                          const rowKey = `${queueItem.matchId}:${queueItem.event.eventId}`;
                          return (
                            <DraggableRow
                              key={key}
                              index={index}
                              item={queueItem}
                              isActive={queueItem.event.eventId === activeEventId}
                              isMultiMatch={isMultiMatch}
                              matchTitle={matchLookup.get(queueItem.matchId)?.title}
                              preOffset={clip?.preRollOffset ?? 0}
                              postOffset={clip?.postRollOffset ?? 0}
                              note={clip?.note}
                              isSelected={selectedClipIds.has(key)}
                              onSelect={(e) => toggleSelectClip(key, e)}
                              isDragTarget={clipDragOverIndex === index}
                              dragTargetPosition={clipDragOverPosition}
                              onClick={() => handleRowClick(queueItem)}
                              onDragStart={(e) => handleClipDragStart(e, key)}
                              onDragOver={(e, i) => handleClipDragOver(e, i)}
                              onDragLeave={() => setClipDragOverIndex(null)}
                              onDrop={(e, i) => handleClipDrop(e, i)}
                              onDragEnd={handleClipDragEnd}
                              onInsertTextCardAbove={() => handleInsertTextCard(index)}
                              onRemove={() => { if (clip) handleRemoveSingleClip(clip); }}
                              labelControls={activeOrgId ? {
                                labels,
                                assignedIds: clipAssignments.get(rowKey) ?? new Set<string>(),
                                onToggle: (labelId, state) => handleToggleClipLabel(queueItem.matchId, queueItem.event.eventId, labelId, state),
                                onCreate: handleCreateLabel,
                                onRename: handleRenameLabel,
                                onRecolor: handleRecolorLabel,
                                onDelete: handleDeleteLabel,
                                onSeedDefaults: handleSeedDefaultLabels,
                                scopeTitle: `Labels in ${selected?.name ?? "this playlist"}`,
                                scopeHint: "Visible only in this playlist",
                              } : undefined}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                </div>
                </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <ResizablePanelGroup key="split" direction="horizontal" autoSaveId="playlists-split" className="min-h-0 flex-1">
                <ResizablePanel defaultSize={45} minSize={20}>
                <div className="flex h-full flex-col gap-3 overflow-hidden pr-3">
                <div className="flex shrink-0 flex-col gap-3">
                {noSync && selected.items.filter(isClipItem).length > 0 && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-950 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
                    No sync point — set one in the game to enable playback controls.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-muted-foreground">Pre</label>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      className="h-7 w-16 text-xs"
                      value={preRoll}
                      onChange={(e) => setPreRoll(Number(e.target.value))}
                    />
                    <label className="text-xs text-muted-foreground">Post</label>
                    <Input
                      type="number"
                      min={0}
                      max={60}
                      className="h-7 w-16 text-xs"
                      value={postRoll}
                      onChange={(e) => setPostRoll(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      onClick={() => setShowClipBrowser(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Clips
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => handleInsertTextCard(sortedEvents.length)}
                    >
                      <Type className="h-3.5 w-3.5" />
                      Add Text Card
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    {isPlaying ? (
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={handleStop}>
                        <Square className="h-3.5 w-3.5" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={() => startQueue(sortedEvents)}
                        disabled={sortedEvents.length === 0 || noSync}
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                        Play Playlist
                      </Button>
                    )}
                    {isExporting ? (
                      <Button size="sm" variant="outline" disabled className="h-8 gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Exporting…
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5"
                        onClick={handleExport}
                        disabled={exportLocked ? playlistEmpty : !!exportDisabledReason}
                        title={exportLocked
                          ? "Export playlists as MP4 with Rookie or Pro"
                          : (exportDisabledReason ?? "Export playlist as MP4")}
                      >
                        {activeOrgPlan === 'free'
                          ? <Lock className="h-3.5 w-3.5" />
                          : <FileDown className="h-3.5 w-3.5" />
                        }
                        {selectedClipIds.size > 0
                          ? `Export ${selectedClipIds.size} selected`
                          : 'Export Playlist'}
                      </Button>
                    )}
                  </div>
                  {/* Share button — icon-only, colored when shared */}
                  {userTeams.length > 0 && (
                    isShipping ? (
                      <Button size="sm" variant="outline" disabled className="h-8 gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {shipProgress ? `${shipProgress.done} / ${shipProgress.total}` : "Uploading…"}
                      </Button>
                    ) : (() => {
                      const teamCount = selected?.teamIds?.length ?? 0;
                      const userCount = selected?.userIds?.length ?? 0;
                      const isShared = teamCount > 0 || userCount > 0;
                      const teamNames = (selected?.teamIds ?? [])
                        .map((id) => userTeams.find((t) => t.id === id)?.name ?? "Team");
                      const parts: string[] = [];
                      if (teamNames.length > 0) parts.push(teamNames.join(", "));
                      if (userCount > 0) parts.push(`${userCount} member${userCount !== 1 ? "s" : ""}`);
                      const sharedLabel = parts.join(" · ");
                      return (
                        <Button
                          size="sm"
                          variant={isShared ? "default" : "outline"}
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setPendingShareTeamIds(new Set(selected?.teamIds ?? []));
                            setPendingShareUserIds(new Set(selected?.userIds ?? []));
                            setMemberSearchQuery("");
                            setShareDialogOpen(true);
                          }}
                          disabled={!!exportDisabledReason}
                          title={isShared ? `Shared with: ${sharedLabel}` : (exportDisabledReason ?? "Share with team or members")}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                        </Button>
                      );
                    })()
                  )}
                  {exportError && (
                    <p className="w-full text-xs text-red-500 mt-1">{exportError}</p>
                  )}
                </div>
                {selectedClipIds.size > 0 && (
                  <div className="flex items-center gap-3 rounded-lg bg-primary/10 px-4 py-2.5">
                    <span className="text-sm font-medium text-primary">
                      {selectedClipIds.size} item{selectedClipIds.size !== 1 ? "s" : ""} selected
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 gap-1 bg-red-600 px-2 text-xs text-white hover:bg-red-700"
                        onClick={handleRemoveSelected}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove from playlist
                      </Button>
                      {selectedClipKeyPairs.length > 0 && (
                        <LabelPickerPopover
                          trigger={
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs">
                              <Tag className="h-3.5 w-3.5" />
                              Apply label
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                          }
                          labels={labels}
                          assignedAllIds={bulkAssignedAll}
                          assignedSomeIds={bulkAssignedSome}
                          onToggle={handleBulkToggleLabel}
                          onCreate={handleCreateLabel}
                          onRename={handleRenameLabel}
                          onRecolor={handleRecolorLabel}
                          onDelete={handleDeleteLabel}
                          onSeedDefaults={handleSeedDefaultLabels}
                          scopeTitle={`Labels in ${selected?.name ?? "this playlist"}`}
                          scopeHint="Visible only in this playlist"
                        />
                      )}
                      {playlists.filter((p) => p.id !== selected?.id).length > 0 && (
                        <div ref={addToDropdownRef} className="relative">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => { setShowAddToDropdown((v) => !v); setAddToSearch(""); }}
                          >
                            Add to another playlist
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                          {showAddToDropdown && (
                            <AddToDropdown
                              playlists={playlists}
                              activePlaylistId={selected?.id ?? null}
                              addToSearch={addToSearch}
                              setAddToSearch={setAddToSearch}
                              onAddToPlaylist={handleAddSelectedToPlaylist}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                </div>

                <div ref={playlistScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                {sortedEvents.length === 0 ? (
                  <div
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes("text/clip")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                      setClipDragOverIndex(0);
                      setClipDragOverPosition("above");
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setClipDragOverIndex(null);
                    }}
                    onDrop={(e) => handleClipDrop(e, 0)}
                    className={`flex min-h-full flex-col items-center justify-center gap-3 py-12 text-center rounded-lg border-2 border-dashed transition-colors ${
                      clipDragOverIndex === 0 ? "border-primary bg-primary/5" : "border-transparent"
                    }`}
                  >
                    <p className="text-sm text-muted-foreground">
                      This playlist has no clips yet.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setShowClipBrowser(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Clips
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[580px] text-sm">
                      <thead className="border-b border-border bg-muted/80 text-xs font-medium text-muted-foreground">
                        <tr>
                          <th className="w-1.5 min-w-1.5 p-0" aria-hidden />
                          <th className="w-8" />
                          <th className="w-8 px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={toggleSelectAll}
                              className="h-3.5 w-3.5 rounded border-border accent-primary"
                            />
                          </th>
                          <th className="px-4 py-2.5 text-left">Period</th>
                          <th
                            className={`px-4 py-2.5 text-left select-none ${hasTextCards ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:text-foreground"}`}
                            onClick={() => !hasTextCards && setClockSort((s) => s === "none" ? "asc" : s === "asc" ? "desc" : "none")}
                            title={hasTextCards ? "Clock sort is unavailable when text cards are present" : undefined}
                          >
                            <span className="inline-flex items-center gap-1">
                              Clock
                              {!hasTextCards && clockSort === "asc" && <ArrowUp className="h-3 w-3" />}
                              {!hasTextCards && clockSort === "desc" && <ArrowDown className="h-3 w-3" />}
                            </span>
                          </th>
                          {isMultiMatch && <th className="px-4 py-2.5 text-left">Game</th>}
                          <th className="px-4 py-2.5 text-left">Event</th>
                          <th className="px-4 py-2.5 text-left">Player</th>
                          <th className="px-4 py-2.5 text-left">Team</th>
                          <th className="px-4 py-2.5" />
                          <th className="px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-card">
                        {sortedEvents.map((item, index) => {
                          const key = itemKey(item);
                          if (isTextCard(item)) {
                            const card = item as PlaylistTextCard;
                            return (
                              <TextCardRow
                                key={key}
                                card={card}
                                index={index}
                                isActive={activeTextCard?.id === card.id}
                                isSelected={selectedClipIds.has(key)}
                                onSelect={(e) => toggleSelectClip(key, e)}
                                isDragTarget={clipDragOverIndex === index}
                                dragTargetPosition={clipDragOverPosition}
                                onClick={() => handleRowClick(card)}
                                onDragStart={(e) => handleClipDragStart(e, key)}
                                onDragOver={(e, i) => handleClipDragOver(e, i)}
                                onDragLeave={() => setClipDragOverIndex(null)}
                                onDrop={(e, i) => handleClipDrop(e, i)}
                                onDragEnd={handleClipDragEnd}
                                onTextChange={handleTextCardTextChange}
                                onTextSave={handleTextCardTextSave}
                                onDurationChange={handleTextCardDurationChange}
                                onRemove={() => handleRemoveSingleTextCard(card)}
                              />
                            );
                          }
                          const queueItem = item as QueueItem;
                          const clip = selected?.items.filter(isClipItem).find(
                            (c) => c.matchId === queueItem.matchId && c.eventId === queueItem.event.eventId
                          );
                          const rowKey = `${queueItem.matchId}:${queueItem.event.eventId}`;
                          return (
                            <DraggableRow
                              key={key}
                              index={index}
                              item={queueItem}
                              isActive={queueItem.event.eventId === activeEventId}
                              isMultiMatch={isMultiMatch}
                              matchTitle={matchLookup.get(queueItem.matchId)?.title}
                              preOffset={clip?.preRollOffset ?? 0}
                              postOffset={clip?.postRollOffset ?? 0}
                              note={clip?.note}
                              isSelected={selectedClipIds.has(key)}
                              onSelect={(e) => toggleSelectClip(key, e)}
                              isDragTarget={clipDragOverIndex === index}
                              dragTargetPosition={clipDragOverPosition}
                              onClick={() => handleRowClick(queueItem)}
                              onDragStart={(e) => handleClipDragStart(e, key)}
                              onDragOver={(e, i) => handleClipDragOver(e, i)}
                              onDragLeave={() => setClipDragOverIndex(null)}
                              onDrop={(e, i) => handleClipDrop(e, i)}
                              onDragEnd={handleClipDragEnd}
                              onInsertTextCardAbove={() => handleInsertTextCard(index)}
                              onRemove={() => { if (clip) handleRemoveSingleClip(clip); }}
                              labelControls={activeOrgId ? {
                                labels,
                                assignedIds: clipAssignments.get(rowKey) ?? new Set<string>(),
                                onToggle: (labelId, state) => handleToggleClipLabel(queueItem.matchId, queueItem.event.eventId, labelId, state),
                                onCreate: handleCreateLabel,
                                onRename: handleRenameLabel,
                                onRecolor: handleRecolorLabel,
                                onDelete: handleDeleteLabel,
                                onSeedDefaults: handleSeedDefaultLabels,
                                scopeTitle: `Labels in ${selected?.name ?? "this playlist"}`,
                                scopeHint: "Visible only in this playlist",
                              } : undefined}
                            />
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                </div>
                </div>
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize={55} minSize={20}>
                <div className="flex h-full flex-col gap-2 pl-3 min-w-0">
                {localVideoUrl ? (
                  <>
                    <div className="relative">
                      <VideoPlayer src={localVideoUrl} videoRef={videoRef} />
                      {activeTextCard && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black transition-opacity duration-200">
                          <p className="text-center text-4xl font-semibold text-white px-8">{activeTextCard.text}</p>
                        </div>
                      )}
                    </div>
                    <VideoClipControls
                      videoRef={videoRef}
                      canPrev={canPrev}
                      canNext={canNext}
                      isQueueActive={isQueueActive}
                      onPrev={handlePrev}
                      onNext={handleNext}
                      onReplay={handleReplay}
                      onStop={handleStop}
                      onPlayAll={() => startQueue(sortedEvents)}
                      activeClipPreOffset={activeClipOffsets.pre}
                      activeClipPostOffset={activeClipOffsets.post}
                      onPreOffsetChange={(delta) => adjustActiveClip(delta, 0)}
                      onPostOffsetChange={(delta) => adjustActiveClip(0, delta)}
                    />
                    {activeClipKey && activeOrgId && (() => {
                      const key = `${activeClipKey.matchId}:${activeClipKey.eventId}`;
                      const assignedIds = clipAssignments.get(key) ?? new Set<string>();
                      const assigned = labels.filter((l) => assignedIds.has(l.id));
                      const playlistName = selected?.name ?? "this playlist";
                      const scopeTitle = `Labels in ${playlistName}`;
                      return (
                        <div className="flex flex-wrap items-center gap-1.5 px-1">
                          <LabelPickerPopover
                            trigger={
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
                                title={scopeTitle}
                              >
                                <Tag className="h-3 w-3" />
                                {assigned.length === 0 ? "Add labels" : "Edit"}
                              </button>
                            }
                            labels={labels}
                            assignedAllIds={assignedIds}
                            onToggle={(labelId, state) => handleToggleClipLabel(activeClipKey.matchId, activeClipKey.eventId, labelId, state)}
                            onCreate={handleCreateLabel}
                            onRename={handleRenameLabel}
                            onRecolor={handleRecolorLabel}
                            onDelete={handleDeleteLabel}
                            onSeedDefaults={handleSeedDefaultLabels}
                            align="start"
                            scopeTitle={scopeTitle}
                            scopeHint="Visible only in this playlist"
                          />
                          {assigned.map((l) => <LabelChip key={l.id} label={l} />)}
                        </div>
                      );
                    })()}
                    {activeEventId !== null && (
                      <textarea
                        className="w-full resize-none rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                        rows={3}
                        placeholder="Add a note for this clip…"
                        value={clipNote}
                        onChange={(e) => handleNoteChange(e.target.value)}
                      />
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <VideoPlaceholder />
                    {noVideo && selected.items.filter(isClipItem).length > 0 && (
                      <p className="text-center text-xs text-muted-foreground">
                        No video linked. Add one in the game.
                      </p>
                    )}
                  </div>
                )}
                </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
          <Dialog open={showClipBrowser} onOpenChange={setShowClipBrowser}>
            <DialogContent
              className="w-[calc(100vw-4rem)] max-w-[calc(100vw-4rem)] sm:max-w-[calc(100vw-4rem)] h-[85vh] p-0 gap-0 bg-card"
              showCloseButton={false}
              onInteractOutside={(e) => {
                if (document.querySelector('[data-resize-handle-state="drag"]')) {
                  e.preventDefault();
                }
              }}
            >
              <ClipBrowserPanel
                matches={matches}
                matchLookup={matchLookup}
                playlist={selected}
                onAddClips={handleAddClips}
                onClose={() => setShowClipBrowser(false)}
                activeOrgId={activeOrgId}
                labels={labels}
                labelHandlers={{
                  onCreate: handleCreateLabel,
                  onRename: handleRenameLabel,
                  onRecolor: handleRecolorLabel,
                  onDelete: handleDeleteLabel,
                  onSeedDefaults: handleSeedDefaultLabels,
                }}
              />
            </DialogContent>
          </Dialog>
          {/* Upgrade dialog — shown when free user tries a paid feature */}
          <UpgradeDialog
            open={upgradeDialogOpen}
            onClose={() => setUpgradeDialogOpen(false)}
            featureName="Export Playlist is a paid feature"
          />
          {/* Share dialog — multi-team */}
          <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Share Playlist</DialogTitle>
              </DialogHeader>
              <div className="py-1">
                {/* Teams section */}
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teams</p>
                <div className="flex flex-col gap-1">
                  {userTeams.map((team) => {
                    const checked = pendingShareTeamIds.has(team.id);
                    return (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => {
                          setPendingShareTeamIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(team.id)) next.delete(team.id);
                            else next.add(team.id);
                            return next;
                          });
                        }}
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-accent${checked ? " bg-accent/60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={checked}
                          className="h-3.5 w-3.5 rounded border-border accent-primary pointer-events-none"
                        />
                        <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="flex-1">{team.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Members section */}
                <p className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Members</p>
                {shareableMembers.length === 0 ? (
                  <p className="px-3 text-xs text-muted-foreground/60">No team members to share with.</p>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                      <input
                        type="text"
                        placeholder="Search members…"
                        value={memberSearchQuery}
                        onChange={(e) => setMemberSearchQuery(e.target.value)}
                        className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
                      {shareableMembers
                        .filter((m) => {
                          const q = memberSearchQuery.toLowerCase();
                          return !q || (m.fullName ?? "").toLowerCase().includes(q);
                        })
                        .map((member) => {
                          const checked = pendingShareUserIds.has(member.id);
                          const initials = (member.fullName ?? "?")
                            .split(" ")
                            .map((w) => w[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase();
                          return (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => {
                                setPendingShareUserIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(member.id)) next.delete(member.id);
                                  else next.add(member.id);
                                  return next;
                                });
                              }}
                              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-accent${checked ? " bg-accent/60" : ""}`}
                            >
                              <input
                                type="checkbox"
                                readOnly
                                checked={checked}
                                className="h-3.5 w-3.5 rounded border-border accent-primary pointer-events-none"
                              />
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                                {initials}
                              </span>
                              <span className="flex-1 truncate">{member.fullName ?? member.email ?? "Unknown"}</span>
                            </button>
                          );
                        })}
                    </div>
                  </>
                )}
              </div>
              <DialogFooter className="flex-row justify-between gap-2">
                {((selected?.teamIds?.length ?? 0) > 0 || (selected?.userIds?.length ?? 0) > 0) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => handleShare([], [])}
                  >
                    Remove all
                  </Button>
                )}
                <div className="flex gap-2 ml-auto">
                  <Button variant="outline" size="sm" onClick={() => setShareDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleShare([...pendingShareTeamIds], [...pendingShareUserIds])}
                  >
                    Done
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>

    </>
  );
}
