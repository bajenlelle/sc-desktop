import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Share2,
  Users,
  ListFilter,
  ListPlus,
  ListVideo,
  MoreHorizontal,
  Plus,
  Scissors,
  Tag,
  VideoOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { togglePlayerMuted } from "@/lib/player-sound";
import { CardImage } from "@/components/editor/card-image";
import { StatsCardInspector } from "@/components/editor/stats-card-inspector";
import type { ScoutingReportRun } from "@/components/editor/scouting-report-dialog";
import { ReportView } from "@/components/report/report-view";
import { generateScoutingReport, type GenerateOutcome } from "@/lib/scouting-report";
import { getMyScoutingReport, type MyScoutingReport } from "@/lib/scouting-reports-db";
import { defaultOpponent, type ReportDraft } from "@scoutable/shared/lib/report-draft";
import { emptyHistory, itemsDiff, materialize, pasteIndexAfter, pasteItems, recordEdit, takeRedo, takeUndo, type History, type ItemsEdit } from "@scoutable/shared/lib/playlist-history";
import { IS_MACOS } from "@/lib/platform";
import { fallbackText, formatCardDate, pickDefaultPlayer, type StatsCardPlayer, type StatsCardSpec } from "@scoutable/shared/lib/stats-card";
import { leagueSeasonsOf, loadGameStats, loadSeasonPlayer, makeGameCard, makeSeasonCard, seasonOf, statsKindOf, type GameStats } from "@/lib/stats-card-data";
import { useLeagues } from "@/lib/use-leagues";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { listMatchesLight, listMatchesByIds, listEventsForMatches, listFolders, createFolder, updateFolder, deleteFolder, updateVideoUrl } from "@/lib/matches-db";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { cn } from "@/lib/utils";
import { listPlaylists, createPlaylist, updatePlaylist, deletePlaylist, addClips, removeClips, reorderItems, updateClip, clearShippedClip, insertTextCard, updateTextCard, setPlaylistTeams, setPlaylistUsers, notifyPendingPlaylistShares } from "@/lib/playlists-db";
import { groupShipFailures, mergeShipResults, type ClipShipResult } from "@scoutable/shared/lib/ship-result";
import { listLabels, createLabel as apiCreateLabel, updateLabel as apiUpdateLabel, deleteLabel as apiDeleteLabel, seedDefaultLabels, listAssignmentsForMatches, setClipAssignments as apiSetClipAssignments, bulkAssign as apiBulkAssign } from "@/lib/labels-db";
import { LabelChip } from "@/components/labels/LabelChip";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import type { Label, LabelColor, ClipKey } from "@scoutable/shared/types/labels";
import { eventColors, eventLabel, formatGameClock, parseGameClock, periodLabel, playerName } from "@scoutable/shared/lib/events";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import type { CropKeyframe } from "@scoutable/shared/lib/crop-path";
import { CropEditorBar, CropOverlay, upsertKeyframe } from "@/components/crop-editor";
import { ExportFormatDialog, type ExportAction } from "@/components/export-format-dialog";
import {
  moveBlock,
  snapGapToGroupBoundary,
  computeGroupRuns,
  normalizeGroups,
  type GroupRunInfo,
} from "@scoutable/shared/lib/clip-groups";
import {
  childFoldersByParent,
  flattenFolderTree,
  collectSubtreeIds,
  wouldCreateCycle,
  buildDescendantMap,
  wouldCreateCycleWith,
  subtreeStats,
  ancestorIds,
} from "@scoutable/shared/lib/folder-tree";
import {
  collectClipMatchIds,
  mergeEventsIntoMatches,
  missingClipMatchIds,
} from "@scoutable/shared/lib/playlist-matches";
import { getOrgContext, getOrgContextForOrg, getOrgMembers, getTeamMemberIds } from "@/lib/profile-db";
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { PurchaseSheet } from "@/components/purchase-sheet";
import { usePlayerAccess } from "@/lib/player-access";
import { canExport } from "@scoutable/shared/lib/player-access";
import { SendToPhoneDialog } from "@/components/send-to-phone-dialog";
import { PlaylistFilterBar, EMPTY_QUEUE_FILTERS, queueFiltersActive, type QueueFilters } from "@/components/playlist-filter-bar";
import type { OrgTeam, UserProfile } from "@/types/org";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { isLocalPath, streamFileSrc } from "@/lib/stream";
import { exportPlaylist, notifyExportSuccess, type ExportSegment } from "@/lib/export";
import { isExportCancelled, type ExportProgress } from "@scoutable/shared/lib/export-progress";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getExportWatermarkDisabled, setHasExported } from "@/lib/prefs";
import { clipAndShip } from "@/lib/clip-and-ship";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { Playlist, PlaylistFolder, PlaylistItem, PlaylistClipItem, PlaylistTextCard, PlayByPlayEvent, StoredMatch } from "@/types/match";
import { isClipItem } from "@/types/match";
import { toast } from "sonner";
import { Page } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import { PlayerStage } from "@/components/editor/player-stage";
import { usePersistentVideo } from "@/components/editor/use-persistent-video";
import { ClipRow, TextCardRow } from "@/components/editor/clip-rows";
import { ClipTrimmer, type TrimWindow } from "@/components/editor/clip-trimmer";
import { formatSeconds, offsetsForTrim, stepToWhole } from "@scoutable/shared/lib/trim-math";
import { Kbd } from "@/components/ui/kbd";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { dragBlockKeys, isSameOrder, itemsIndexForGap } from "@scoutable/shared/lib/list-reorder";
import {
  clickSelection,
  extendSelection,
  focusAfterRemoval,
  moveFocus,
  pruneSelection,
  type FocusMove,
} from "@scoutable/shared/lib/list-selection";
import { Callout } from "@/components/ui/group";
import { EmptyState } from "@/components/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { ShareRecipients } from "@/components/playlist/share-recipients";
import { Stepper } from "@/components/ui/stepper";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AddToPopover } from "@/components/editor/add-to-popover";
import { BROWSER_WIDTH, BrowserColumn } from "@/components/editor/browser-column";
import { ClipBrowserPanel } from "@/components/editor/clip-browser-panel";
import { PILL_LABEL, PillButton, SelectionBar } from "@/components/editor/selection-bar";
import { useListDrag, type DragTarget } from "@/components/editor/use-list-drag";
import { AutoHeight } from "@/components/ui/auto-height";
import { AnimatePresence, motion } from "framer-motion";
import { fadeVariants, springs, useReducedMotionSafe } from "@/lib/motion";

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

/** items-space twin of itemKey (display-space). */
function playlistItemKey(i: PlaylistItem): string {
  return isClipItem(i) ? `${i.matchId}:${i.eventId}` : `text:${i.id}`;
}

/** A row's DOM id, for the grid's aria-activedescendant. */
function rowDomId(key: string): string {
  return `clip-row-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** The row element for a key, inside the given list only. */
function findRow(container: HTMLElement | null, key: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`) ?? null;
}

/**
 * A new playlist keeps its `temp-` id until the save of its name returns, and
 * the database rejects that id: until then nothing may open, fill or target it.
 */
/** One toast for changes to the rows and their undo: a new one replaces the last. */
const EDIT_TOAST = "playlist-edit";
/** The modifier the edit shortcuts use, as the toasts name it. */
const MOD = IS_MACOS ? "⌘" : "Ctrl+";
/**
 * What ⌘C or ⌘X took, for ⌘V in this playlist or another. The app's own
 * clipboard: rows can't travel through the system's, which gets them as text.
 */
let rowClipboard: PlaylistItem[] = [];

function isUnsavedId(id: string): boolean {
  return id.startsWith("temp-");
}

/** The filter bar and the "Filtered" strip under the toolbar: a few points of travel, then still. */
const revealVariants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0, transition: springs.standard },
  exit: { opacity: 0, y: -6, transition: springs.exit },
};

// ---------------------------------------------------------------------------
// The playlist browser column remembers its width and whether it is shown.
// ---------------------------------------------------------------------------

const BROWSER_COLLAPSED_KEY = "scoutable_playlist_browser_collapsed";
const BROWSER_WIDTH_KEY = "scoutable_playlist_browser_width";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------


// Playlists where the stats suggestion was dismissed: a per-viewer convenience.
const STATS_HINT_KEY = "scoutable_stats_card_hint_dismissed";

function readStatsHintDismissed(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_HINT_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeStatsHintDismissed(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(STATS_HINT_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Storage unavailable: the suggestion just comes back next time.
  }
}

export function PlaylistsPage() {
  const { user, activeOrgId, activeOrgPlan, activeOrgRole, activeOrgIsPersonal, myOrgs, profile, profileLoading } = useAuth();
  // Export opens for paid plans, and for a Free space once anything is bought
  // (a single game; a Pro subscription only while it lasts).
  const { access: playerAccess, playerMode } = usePlayerAccess();
  const exportAllowed = canExport(activeOrgPlan, playerAccess);
  const navigate = useNavigate();
  const location = useLocation();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);
  const [matches, setMatches] = useState<StoredMatch[]>([]);
  // Games in another space that this space's playlists have clips on: a
  // personal playlist whose game moved to a club, or a club playlist with a
  // clip on the personal sample game. For resolving clips only; the clip
  // browser keeps listing this space's games (`matches`).
  const [outsideMatches, setOutsideMatches] = useState<StoredMatch[]>([]);
  const outsideMatchesRef = useRef(outsideMatches);
  useEffect(() => { outsideMatchesRef.current = outsideMatches; }, [outsideMatches]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  // Which matches already have their play-by-play in `matches`. The mount load
  // covers only the games playlists reference; the clip browser can display
  // any game, so it asks for the rest on demand via ensureEventsFor.
  const loadedEventMatchIdsRef = useRef<Set<string>>(new Set());
  const eventFetchInFlightRef = useRef<Set<string>>(new Set());
  // The same bookkeeping for the games whose labels are loaded (ensureLabelsFor).
  const loadedLabelMatchIdsRef = useRef<Set<string>>(new Set());
  const labelFetchInFlightRef = useRef<Set<string>>(new Set());
  // `playlistId:clipKey` pairs with an addClips call in flight — the drop
  // handlers' membership checks read state that lags the network call.
  const clipAddInFlightRef = useRef<Set<string>>(new Set());
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
  // Where the rename was initiated. The selected playlist renders in BOTH the
  // sidebar and the header; keying the inline input on the id alone mounted
  // two autoFocus inputs at once, and whichever lost the focus race fired
  // onBlur → handleRenamePlaylist → close, cancelling the rename instantly.
  const [editingVia, setEditingVia] = useState<"sidebar" | "header">("sidebar");
  // Playlist pending delete confirmation — deletion is irreversible and
  // unshares the playlist, so it never runs on a bare icon click.
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);
  const [deletingPlaylist, setDeletingPlaylist] = useState(false);
  const [openMenuPlaylistId, setOpenMenuPlaylistId] = useState<string | null>(null);
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null);
  /** Non-empty folder pending subtree-delete confirmation. */
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<PlaylistFolder | null>(null);
  // dataTransfer payloads are unreadable during dragover, so live cycle checks
  // while hovering need the dragged folder id in a ref.
  const draggedFolderIdRef = useRef<string | null>(null);
  const [clockSort, setClockSort] = useState<ClockSort>("none");
  const [search, setSearch] = useState("");
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Surfaced as a toast: an error is feedback, not a permanent line of
  // chrome under the toolbar.
  useEffect(() => {
    if (exportError) toast.error(exportError);
  }, [exportError]);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [isShipping, setIsShipping] = useState(false);
  const [shipProgress, setShipProgress] = useState<{ done: number; total: number } | null>(null);
  const [userTeams, setUserTeams] = useState<OrgTeam[]>([]);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [pendingShareTeamIds, setPendingShareTeamIds] = useState<Set<string>>(new Set());
  const [pendingShareUserIds, setPendingShareUserIds] = useState<Set<string>>(new Set());
  // Ship-before-notify: the dialog walks pick → uploading → (resolve on
  // failures). Share rows are only written AFTER clips upload, so recipients
  // are never notified about clips they can't watch.
  type SharePhase =
    | { kind: "pick" }
    | { kind: "uploading" }
    | {
        kind: "resolve";
        result: ClipShipResult;
        total: number;
        teamIds: string[];
        userIds: string[];
        failedSegments: ExportSegment[];
      };
  const [sharePhase, setSharePhase] = useState<SharePhase>({ kind: "pick" });
  const shareAbortRef = useRef<AbortController | null>(null);
  const [shareableMembers, setShareableMembers] = useState<UserProfile[]>([]);
  const [sharedSectionExpanded, setSharedSectionExpanded] = useState(true);
  // Clip browser panel
  const [showClipBrowser, setShowClipBrowser] = useState(false);
  // Getting Started checklist arrival: which button to pulse until clicked
  // or a few seconds pass.
  const [onboardingHighlight, setOnboardingHighlight] = useState<"add-clips" | "export" | "share" | null>(null);
  const [sendToPhoneOpen, setSendToPhoneOpen] = useState(false);
  const [sendToPhoneSegments, setSendToPhoneSegments] = useState<ExportSegment[]>([]);
  const [sendToPhoneVertical, setSendToPhoneVertical] = useState(false);
  // Which export action is waiting on a format pick (null = dialog closed).
  const [exportFormatAction, setExportFormatAction] = useState<ExportAction | null>(null);
  // What the last format pick asked for — shapes the upgrade dialog's copy
  // and its upgrade_gate_hit analytics when the free-plan gate trips.
  const [upsellContext, setUpsellContext] = useState<{ action: ExportAction; format: "16:9" | "9:16" } | null>(null);
  // A purchase from the export gate carries on with what was asked for, once
  // the fresh player access has re-rendered the gate open.
  const [resumeExport, setResumeExport] = useState<{ action: ExportAction; format: "16:9" | "9:16" } | null>(null);
  useEffect(() => {
    if (!resumeExport || !exportAllowed) return;
    const { action, format } = resumeExport;
    setResumeExport(null);
    const vertical = format === "9:16";
    if (action === "save") void handleExport(vertical);
    else handleSendToPhone(vertical);
    // handleExport/handleSendToPhone read the current render's state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeExport, exportAllowed]);
  // Vertical-crop editor: overlay visible + "export view" dim toggle.
  const [cropMode, setCropMode] = useState(false);
  const [cropDimmed, setCropDimmed] = useState(false);
  // Trim: the playing clip's ends on handles over the player (ClipTrimmer).
  // Nothing plays or advances on its own meanwhile (trimActiveRef).
  const [trim, setTrim] = useState<{
    key: string;
    matchId: string;
    eventId: number;
    eventTime: number;
    start: number;
    end: number;
  } | null>(null);
  const trimActiveRef = useRef(false);
  trimActiveRef.current = trim !== null;
  /** A row's "Trim clip…" on a clip that isn't playing: trim once it is. */
  const pendingTrimKeyRef = useRef<string | null>(null);
  // Fullscreen player (native window fullscreen + fixed stage layer).
  const playerFs = usePlayerFullscreen();
  const playerFsRef = useRef(playerFs);
  playerFsRef.current = playerFs;
  // Full screen needs footage to show: with no video on the stage it only
  // ever exits (F, ⌘⇧F and the menu used to blank the window).
  const hasStageRef = useRef(false);
  hasStageRef.current = !!localVideoUrl;
  const toggleFullscreen = useCallback(() => {
    if (!playerFsRef.current.active && !hasStageRef.current) return;
    playerFsRef.current.toggle();
  }, []);
  // View → Fullscreen Player (⌘⇧F) — same CustomEvent bridge as ⌘B. While
  // Add clips is open its own player takes it (clip-browser-panel.tsx).
  const showClipBrowserRef = useRef(false);
  showClipBrowserRef.current = showClipBrowser;
  useEffect(() => {
    const handler = () => {
      if (showClipBrowserRef.current) return;
      toggleFullscreen();
    };
    window.addEventListener("player-fullscreen-toggle", handler);
    return () => window.removeEventListener("player-fullscreen-toggle", handler);
  }, [toggleFullscreen]);
  // Playlist IDs whose clips need shipping as soon as state settles: arriving
  // from the dashboard's "Upload missing clips", or after adding clips to an
  // already-shared playlist (which previously left them stranded un-shipped).
  // Carries IDs (not a boolean) so ships target the right playlists even if
  // the coach switches focus before they run; a Set because drag-drop can arm
  // several targets in quick succession — the watcher drains them one by one.
  const pendingShipRef = useRef<Set<string>>(new Set());
  // Ref writes don't re-render — bump this to wake the pending-ship watcher.
  const [shipNonce, setShipNonce] = useState(0);
  const hl = (key: "add-clips" | "export" | "share") =>
    onboardingHighlight === key
      ? " ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse"
      : "";

  // Labels — per (user, org) vocabulary + per-clip assignments
  const [labels, setLabels] = useState<Label[]>([]);
  // Map keyed `${matchId}:${eventId}` -> Set of labelIds on that clip, for
  // every game loaded so far (ensureLabelsFor). The editor and the clip
  // browser both read it, so a label set in either shows in both.
  const [clipAssignments, setClipAssignments] = useState<Map<string, Set<string>>>(new Map());
  // In-playlist filter lens (transient — reset on playlist switch).
  const [queueFilters, setQueueFilters] = useState<QueueFilters>({ ...EMPTY_QUEUE_FILTERS });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Clip drag: what the pointer engine (use-list-drag.ts) is hovering. The
  // list gap only shows for an empty list (rows open the gap themselves);
  // playlist and folder hovers drive the highlight and spring-loading.
  const [clipDropGap, setClipDropGap] = useState<number | null>(null);
  const [clipDragOverPlaylistId, setClipDragOverPlaylistId] = useState<string | null>(null);
  const [clipExpandFolderId, setClipExpandFolderId] = useState<string | null>(null);
  const [clipOpenPlaylistId, setClipOpenPlaylistId] = useState<string | null>(null);
  const clipDragFolderExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipDragPlaylistOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playlistScrollRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  // Refs mirroring state, read from the engine's callbacks between renders.
  const clipDragOverPlaylistIdRef = useRef<string | null>(null);
  const clipDragOverFolderIdRef = useRef<string | null>(null);
  const playlistsRef = useRef<Playlist[]>([]);
  const expandedFoldersRef = useRef(expandedFolders);
  useEffect(() => { expandedFoldersRef.current = expandedFolders; }, [expandedFolders]);
  const uncategorizedExpandedRef = useRef(uncategorizedExpanded);
  useEffect(() => { uncategorizedExpandedRef.current = uncategorizedExpanded; }, [uncategorizedExpanded]);
  // The playlist browser column: its width and whether it is shown are the
  // coach's choices and survive restarts.
  const [browserCollapsed, setBrowserCollapsed] = useState(
    () => localStorage.getItem(BROWSER_COLLAPSED_KEY) === "1",
  );
  const [browserWidth, setBrowserWidth] = useState(() => {
    const n = Number(localStorage.getItem(BROWSER_WIDTH_KEY));
    return Number.isFinite(n) && n >= BROWSER_WIDTH.min && n <= BROWSER_WIDTH.max ? n : BROWSER_WIDTH.default;
  });
  useEffect(() => { localStorage.setItem(BROWSER_COLLAPSED_KEY, browserCollapsed ? "1" : "0"); }, [browserCollapsed]);
  useEffect(() => { localStorage.setItem(BROWSER_WIDTH_KEY, String(browserWidth)); }, [browserWidth]);

  // Text card playback
  const [activeTextCard, setActiveTextCard] = useState<PlaylistTextCard | null>(null);
  const textCardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A card on the stage can be held: its timer keeps the time it has left.
  const [cardPaused, setCardPaused] = useState(false);
  const cardRemainingRef = useRef(0);
  const cardStartedAtRef = useRef(0);
  // A card just added, to show held on the stage once the list has it.
  const [pendingShowCardId, setPendingShowCardId] = useState<string | null>(null);
  const leagues = useLeagues();
  const activeTextCardRef = useRef<PlaylistTextCard | null>(null);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);

  const [newlyInsertedCardId, setNewlyInsertedCardId] = useState<string | null>(null);

  // The scouting report: whether the playlist's report view is open in place of
  // the editor, the clip to reveal when coming back from it, and the playlist's live report.
  // The playlist whose report is open; another playlist selected means the editor again, in the same render.
  const [reportFor, setReportFor] = useState<string | null>(null);
  const reportView = !!selected && reportFor === selected.id;
  const pendingRevealKeyRef = useRef<string | null>(null);
  // ⌘Z / ⇧⌘Z per playlist for this session (lib/playlist-history.ts), and each
  // playlist's writes in order, so an undo never overtakes the edit it undoes.
  const historyRef = useRef(new Map<string, History>());
  const writeChainRef = useRef(new Map<string, Promise<boolean>>());
  // The toolbar row the report view fills, so its toolbar sits where the clips toolbar does.
  const [reportToolbarSlot, setReportToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [myReport, setMyReport] = useState<MyScoutingReport | null>(null);
  const [upsellReport, setUpsellReport] = useState(false);

  // Item selection (clips and text cards)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set()); // "matchId:eventId" or "text:uuid"
  // Keyboard focus in the clip list, a macOS table's: the row the arrows
  // move from, kept apart from the selection. It follows whatever starts
  // playing. The anchor is where a Shift range grows from.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  // The focus ring shows while the list is driven from the keyboard and
  // goes at the next pointer press, the way :focus-visible does.
  const [keyboardNav, setKeyboardNav] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);

  // One <video> for the editor's life: layouts and fullscreen move it,
  // never recreate it (see use-persistent-video.ts).
  const persistentVideo = usePersistentVideo();
  const videoRef = useRef<HTMLVideoElement | null>(persistentVideo);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  // Add Clips is a modal task with its own preview: the editor's footage
  // holds still behind the sheet (the queue stays, Space resumes it).
  useEffect(() => {
    if (showClipBrowser) videoRef.current?.pause();
  }, [showClipBrowser]);
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

  /**
   * The playing row by its list key (`matchId:eventId`, or `text:id` for a
   * text card). Event ids repeat across games, so a multi-game playlist must
   * never match the playing row by event id alone.
   */
  const activeKey = activeTextCard
    ? `text:${activeTextCard.id}`
    : activeEventId !== null && activeMatchId !== null
      ? `${activeMatchId}:${activeEventId}`
      : null;

  // Sync note textarea when active clip changes
  useEffect(() => {
    if (activeEventId === null || !selected) { setClipNote(""); return; }
    const clip = selected.items.filter(isClipItem).find(
      (c) => c.matchId === activeMatchId && c.eventId === activeEventId
    );
    setClipNote(clip?.note ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, selected?.id]);

  // Load playlists + matches on mount; restore selection if returning from match detail
  useEffect(() => {
    const state = location.state as {
      restore?: { playlistId: string };
      createNew?: boolean;
      /** Set by the Getting Started checklist — pulse the step's button. */
      highlight?: "add-clips" | "export" | "share";
      /** Set by the coach dashboard — upload this playlist's missing clips. */
      reship?: boolean;
    } | null;
    const restore = state?.restore;
    const createNew = state?.createNew;
    // One-shot flags: clear them from the history entry once read, or a
    // remount of this page would restore/reship/create all over again.
    if (state) navigate(location.pathname, { replace: true, state: null });
    if (state?.reship && restore) pendingShipRef.current.add(restore.playlistId);
    let highlightTimer: number | undefined;
    if (state?.highlight) {
      setOnboardingHighlight(state.highlight);
      highlightTimer = window.setTimeout(() => setOnboardingHighlight(null), 6000);
    }
    // Switching org must close the open playlist COMPLETELY. The stale
    // `selected` object belongs to the previous org: its clips can't resolve
    // against the new org's matches (they render as vanished), yet the header
    // and Add Clips still target it — so an add silently writes clips into
    // the OLD org's playlist. Same reasoning for an in-progress sidebar
    // rename: committing it after the switch would create the playlist in
    // the NEW org. (The `restore` branch below re-selects within this run,
    // so navigation-driven selection still works.)
    setSelected(null);
    setSelectedClipIds(new Set());
    setShowClipBrowser(false);
    setPendingNewPlaylistId(null);
    setEditingPlaylistId(null);
    setEditPlaylistName("");
    // Labels belong to the space too: the per-game cache starts over.
    setClipAssignments(new Map());
    loadedLabelMatchIdsRef.current = new Set();
    labelFetchInFlightRef.current = new Set();
    // Matches take the same includeUnscoped treatment as playlists/folders:
    // a legacy unscoped playlist otherwise references matches this page
    // can't see, so its clips silently vanish from every list.
    Promise.all([listPlaylists(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }), listMatchesLight(activeOrgId ?? undefined, { ownOnly: true, includeUnscoped: activeOrgIsPersonal }), listFolders(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }), (activeOrgId ? getOrgContextForOrg(activeOrgId, { myOrgs }) : getOrgContext()).catch(() => null)])
      .then(async ([loadedPlaylists, matchShells, loadedFolders, orgCtx]) => {
        // Events only for matches a playlist actually references. Passing
        // every match id pulled the complete play-by-play of every game the
        // coach had ever imported (~500 events each) on every mount. The clip
        // browser fetches whichever game it displays via ensureEventsFor.
        //
        // collectClipMatchIds, not collectReferencedMatchIds: the editor must
        // resolve UNSHIPPED clips too, or their rows vanish (see displayItems).
        const referencedIds = collectClipMatchIds(loadedPlaylists);
        // Mark ids loaded ONLY on success — marking them after a failed
        // fetch disabled ensureEventsFor's retry for the whole session, so
        // every referenced playlist rendered empty until app restart.
        let eventsByMatch: Record<string, PlayByPlayEvent[]> = {};
        try {
          eventsByMatch = await listEventsForMatches(referencedIds);
          loadedEventMatchIdsRef.current = new Set(referencedIds);
        } catch {
          // ensureEventsFor refetches per-game as the clip browser opens.
        }
        const loadedMatches = mergeEventsIntoMatches(matchShells, eventsByMatch);
        // referencedIds already covered their events; only the rows are missing.
        const outsideIds = missingClipMatchIds(loadedPlaylists, new Set(matchShells.map((m) => m.id)));
        const outsideShells = outsideIds.length > 0 ? await listMatchesByIds(outsideIds) : [];

        setPlaylists(loadedPlaylists);
        setMatches(loadedMatches);
        setOutsideMatches(mergeEventsIntoMatches(outsideShells, eventsByMatch));
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
          setEditingVia("sidebar");
          setEditingPlaylistId(tempId);
          setEditPlaylistName("New Playlist");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => { if (highlightTimer !== undefined) window.clearTimeout(highlightTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  // Demo seeding can land after this page mounts (auth-context fires
  // demo-seeded when the sample-game copy completes), and imports elsewhere
  // dispatch matches-changed — refresh the match list so the clip browser's
  // empty state self-corrects. Matches only: rerunning the full load effect
  // would clobber the open playlist's selection/editing state. Fresh row
  // fields win (a relink's videoUrl or a re-set syncPoint must propagate —
  // keeping old objects verbatim silently discarded those updates); only the
  // merged play-by-play survives from the old object, since shells arrive
  // with events: [] and ensureEventsFor skips already-loaded ids.
  useEffect(() => {
    const refreshMatches = () => {
      listMatchesLight(activeOrgId ?? undefined, { ownOnly: true, includeUnscoped: activeOrgIsPersonal })
        .then((shells) => {
          setMatches((prev) => {
            // listMatchesLight returns [] on a FAILED query too (it reports,
            // but can't throw). Blanking `matches` here empties eventByKey and
            // silently drops every clip card from the open playlist — a
            // relink (which fires matches-changed) must never do that. Keep
            // the previous rows; the only way to lose a match mid-session
            // would be a delete from another device, which self-corrects on
            // the next successful refresh or remount.
            if (shells.length === 0 && prev.length > 0) return prev;
            const prevById = new Map(prev.map((m) => [m.id, m]));
            return shells.map((s) => {
              const known = prevById.get(s.id);
              return known ? { ...s, events: known.events } : s;
            });
          });
        })
        .catch(() => {});
      // A relink of a game in another space fires matches-changed too.
      const outside = outsideMatchesRef.current;
      if (outside.length > 0) {
        listMatchesByIds(outside.map((m) => m.id)).then((rows) => {
          if (rows.length === 0) return;
          setOutsideMatches((prev) => {
            const prevById = new Map(prev.map((m) => [m.id, m]));
            return rows.map((r) => ({ ...r, events: prevById.get(r.id)?.events ?? [] }));
          });
        });
      }
    };
    window.addEventListener("demo-seeded", refreshMatches);
    window.addEventListener("matches-changed", refreshMatches);
    return () => {
      window.removeEventListener("demo-seeded", refreshMatches);
      window.removeEventListener("matches-changed", refreshMatches);
    };
  }, [activeOrgId, activeOrgIsPersonal]);

  /**
   * Fetch play-by-play for matches that don't have it yet and merge it in.
   *
   * The mount load covers only games a playlist references, so the clip
   * browser calls this for whichever game it is about to show. Already-loaded
   * and in-flight ids are skipped, making repeat opens and re-renders free.
   * Existing events are preserved — only the newly fetched matches change.
   */
  const ensureEventsFor = useCallback(async (matchIds: string[]) => {
    const wanted = matchIds.filter(
      (id) => id && !loadedEventMatchIdsRef.current.has(id) && !eventFetchInFlightRef.current.has(id),
    );
    if (wanted.length === 0) return;
    for (const id of wanted) eventFetchInFlightRef.current.add(id);
    try {
      const eventsByMatch = await listEventsForMatches(wanted);
      for (const id of wanted) loadedEventMatchIdsRef.current.add(id);
      setMatches((prev) =>
        prev.map((m) => (eventsByMatch[m.id] ? { ...m, events: eventsByMatch[m.id] } : m)),
      );
    } catch (e) {
      console.error("ensureEventsFor:", e);
    } finally {
      for (const id of wanted) eventFetchInFlightRef.current.delete(id);
    }
  }, []);

  /**
   * Fetch the user's labels on every clip of these games and merge them in,
   * the way ensureEventsFor does for play-by-play: loaded and in-flight games
   * are skipped, other games' entries stay. The editor asks for the open
   * playlist's games, the clip browser for the game it shows. Merged, not
   * replaced, so a label toggled while its game's rows are still on the way
   * isn't lost.
   */
  const ensureLabelsFor = useCallback(async (matchIds: string[]) => {
    if (!activeOrgId) return;
    const wanted = matchIds.filter(
      (id) => id && !loadedLabelMatchIdsRef.current.has(id) && !labelFetchInFlightRef.current.has(id),
    );
    if (wanted.length === 0) return;
    for (const id of wanted) labelFetchInFlightRef.current.add(id);
    try {
      const rows = await listAssignmentsForMatches(activeOrgId, wanted);
      for (const id of wanted) loadedLabelMatchIdsRef.current.add(id);
      setClipAssignments((prev) => {
        const next = new Map(prev);
        for (const r of rows) {
          const key = `${r.matchId}:${r.eventId}`;
          const set = new Set(next.get(key) ?? []);
          set.add(r.labelId);
          next.set(key, set);
        }
        return next;
      });
    } catch (e) {
      console.error("ensureLabelsFor:", e);
    } finally {
      for (const id of wanted) labelFetchInFlightRef.current.delete(id);
    }
  }, [activeOrgId]);

  // Load label vocabulary for the active org. Re-runs when org switches.
  useEffect(() => {
    if (!activeOrgId) { setLabels([]); return; }
    listLabels(activeOrgId)
      .then((rows) => setLabels(rows))
      .catch((e) => console.error("listLabels:", e));
  }, [activeOrgId]);

  // A filter is a momentary lens — switching playlists clears it.
  useEffect(() => {
    setQueueFilters({ ...EMPTY_QUEUE_FILTERS });
    setFiltersOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // The clips whose labels we need, plus a stable string identity for that
  // set. Every mutation (note keystroke, roll nudge, reorder) replaces the
  // whole `selected` object, so keying the effect below on `selected` re-ran
  // two label fetches — each fanning out one query per distinct match — on
  // every debounced note save. The clip SET is what the fetch depends on.
  const selectedClipKeys = useMemo<ClipKey[]>(
    () =>
      selected
        ? selected.items.filter(isClipItem).map((c) => ({ matchId: c.matchId, eventId: c.eventId }))
        : [],
    [selected],
  );
  const selectedClipKeysKey = useMemo(
    () => selectedClipKeys.map((c) => `${c.matchId}:${c.eventId}`).join(","),
    [selectedClipKeys],
  );

  // Self-heal the open queue: displayItems silently drops any clip whose
  // event isn't loaded, so a playlist referencing matches the mount fetch
  // missed (it failed, or the playlist arrived after mount) rendered its
  // clips invisible until the clip browser happened to fetch that game.
  // ensureEventsFor skips loaded/in-flight ids, so this is free when healthy.
  // The clips' labels come from the same kind of per-game cache.
  useEffect(() => {
    const games = [...new Set(selectedClipKeys.map((c) => c.matchId))];
    const missing = games.filter((id) => !loadedEventMatchIdsRef.current.has(id));
    if (missing.length > 0) void ensureEventsFor(missing);
    void ensureLabelsFor(games);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedClipKeys is fully represented by selectedClipKeysKey
  }, [selectedClipKeysKey, ensureEventsFor, ensureLabelsFor]);

  /**
   * Clip lookup by `matchId:eventId`.
   *
   * The queue row renderers used to run
   * `selected.items.filter(isClipItem).find(...)` per row — a fresh
   * intermediate array plus a linear scan for every rendered row, so a
   * 150-clip playlist did 150 allocations and ~22,500 comparisons per render,
   * in each of the two view modes.
   */
  const clipByKey = useMemo(() => {
    const map = new Map<string, PlaylistClipItem>();
    if (selected) {
      for (const item of selected.items) {
        if (isClipItem(item)) map.set(`${item.matchId}:${item.eventId}`, item);
      }
    }
    return map;
  }, [selected]);

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
      if (!activeOrgId) return;
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
        await apiSetClipAssignments(activeOrgId, matchId, eventId, Array.from(wanted));
        if (nextAssigned) trackEvent("label_applied", { bulk: false });
      } catch (e) {
        console.error("toggle clip label:", e);
        toast.error("Failed to update label");
      }
    },
    [activeOrgId, clipAssignments, setClipAssignmentLocal],
  );

  const handleCreateLabel = useCallback(
    async (name: string, color: LabelColor): Promise<Label> => {
      if (!activeOrgId) throw new Error("No active org");
      const created = await apiCreateLabel(activeOrgId, name, color);
      trackEvent("label_created", { seeded: false });
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
    trackEvent("label_created", { seeded: true });
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

  /** One label on or off many clips at once: the selection bar's and the clip browser's bulk picker. */
  const applyBulkLabel = useCallback(
    async (clips: ClipKey[], labelId: string, state: LabelTriState) => {
      if (!activeOrgId || clips.length === 0) return;
      const mode: "add" | "remove" = state === "all" ? "remove" : "add";
      // Optimistic UI
      setClipAssignments((prev) => {
        const next = new Map(prev);
        for (const { matchId, eventId } of clips) {
          const key = `${matchId}:${eventId}`;
          const set = new Set(next.get(key) ?? []);
          if (mode === "add") set.add(labelId); else set.delete(labelId);
          next.set(key, set);
        }
        return next;
      });
      try {
        await apiBulkAssign(activeOrgId, clips, labelId, mode);
        if (mode === "add") trackEvent("label_applied", { bulk: true });
      } catch (e) {
        console.error("bulk toggle label:", e);
        toast.error("Failed to apply label");
      }
    },
    [activeOrgId],
  );

  const handleBulkToggleLabel = useCallback(
    (labelId: string, state: LabelTriState) => applyBulkLabel(selectedClipKeyPairs, labelId, state),
    [applyBulkLabel, selectedClipKeyPairs],
  );


  // Every game a clip here can be on: this space's plus the outside ones.
  const clipMatches = useMemo(
    () => (outsideMatches.length > 0 ? [...matches, ...outsideMatches] : matches),
    [matches, outsideMatches],
  );

  // Build match lookup for cross-match event resolution
  const matchLookup = useMemo(
    () => new Map(clipMatches.map((m) => [m.id, m])),
    [clipMatches]
  );
  const matchLookupRef = useRef(matchLookup);
  useEffect(() => { matchLookupRef.current = matchLookup; }, [matchLookup]);

  /**
   * Event lookup by `matchId:eventId`, built once per matches change.
   *
   * Resolving a clip through `match.events.find(...)` scanned a full
   * play-by-play array (~500 events per game) for every clip, so a 150-clip
   * playlist cost ~75,000 comparisons on each recompute of the queue.
   */
  const eventByKey = useMemo(() => {
    const map = new Map<string, PlayByPlayEvent>();
    for (const m of clipMatches) {
      for (const e of m.events) map.set(`${m.id}:${e.eventId}`, e);
    }
    return map;
  }, [clipMatches]);

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
      seekAndPlay(video!, seekTo, clipEnd);
    }
    video.addEventListener("canplay", handleCanPlay, { once: true });
    return () => video.removeEventListener("canplay", handleCanPlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localVideoUrl]);

  // Folder tree: parent id (null = root) -> sorted child folders
  const childFolders = useMemo(() => childFoldersByParent(folders), [folders]);

  // Both feed the "Move to folder" submenus, which every playlist row and
  // every folder row builds. JSX children are constructed eagerly — Radix
  // declines to MOUNT a closed menu, but the array and each item's `disabled`
  // prop are already computed — so calling flattenFolderTree/wouldCreateCycle
  // inline cost O(F) and O(F²) per row on every render, menus closed or not.
  // Hoisted here they are computed once per folder change.
  const flatFolders = useMemo(() => flattenFolderTree(folders), [folders]);
  const folderDescendants = useMemo(() => buildDescendantMap(folders), [folders]);

  // folderId -> lowercased "own name + all ancestor names", so searching a
  // parent folder's name surfaces playlists in its subfolders too.
  const folderSearchText = useMemo(() => {
    const map = new Map<string, string>();
    const byId = new Map(folders.map((f) => [f.id, f]));
    for (const f of folders) {
      const names = [f.name, ...ancestorIds(folders, f.id).map((id) => byId.get(id)?.name ?? "")];
      map.set(f.id, names.join(" ").toLowerCase());
    }
    return map;
  }, [folders]);

  // Filter playlists by search (playlist name or any ancestor folder name)
  const filteredPlaylists = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return playlists;
    return playlists.filter((pl) => {
      if (pl.name.toLowerCase().includes(q)) return true;
      if (pl.folderId && folderSearchText.get(pl.folderId)?.includes(q)) return true;
      return false;
    });
  }, [playlists, search, folderSearchText]);

  // While searching, render only folders that contain a match (or an ancestor
  // of one) — empty branches disappear instead of cluttering the results.
  const visibleFolderIdsWhileSearching = useMemo(() => {
    if (!search.trim()) return null;
    const visible = new Set<string>();
    for (const pl of filteredPlaylists) {
      if (!pl.folderId) continue;
      visible.add(pl.folderId);
      for (const id of ancestorIds(folders, pl.folderId)) visible.add(id);
    }
    return visible;
  }, [search, filteredPlaylists, folders]);

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

  // Clear clip selection and focus when active playlist changes
  useEffect(() => {
    setSelectedClipIds(new Set());
    setFocusKey(null);
    setAnchorKey(null);
    setKeyboardNav(false);
  }, [selected?.id]);

  const isMultiMatch = useMemo(
    () => new Set(selected?.items.filter(isClipItem).map((c) => c.matchId)).size > 1,
    [selected]
  );

  const hasTextCards = useMemo(
    () => selected?.items.some((i) => i.type === 'text') ?? false,
    [selected]
  );

  const hasGroups = useMemo(
    () => selected?.items.some((i) => !!i.groupId) ?? false,
    [selected]
  );

  /** itemKey -> groupId, from the source-of-truth items array. */
  const itemGroupIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of selected?.items ?? []) {
      if (it.groupId) m.set(playlistItemKey(it), it.groupId);
    }
    return m;
  }, [selected]);

  // Clock sort would tear group runs apart, just like it would scatter text cards.
  const clockSortLocked = hasTextCards || hasGroups;

  // displayItems: ordered mix of QueueItems and PlaylistTextCards
  const displayItems = useMemo((): PlaybackItem[] => {
    if (!selected) return [];
    const items: PlaybackItem[] = [];
    for (const item of selected.items) {
      if (isClipItem(item)) {
        const event = eventByKey.get(`${item.matchId}:${item.eventId}`);
        if (event) items.push({ event, matchId: item.matchId });
      } else {
        items.push(item);
      }
    }
    return items;
  }, [selected, eventByKey]);

  // sortedEvents: displayItems optionally sorted by clock (only when no text cards or groups)
  const sortedEvents = useMemo((): PlaybackItem[] => {
    if (clockSortLocked || clockSort === "none") return displayItems;
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
  }, [displayItems, clockSort, clockSortLocked]);

  /** itemKey -> run info over the reorder-space list, for group visuals. */
  const groupRuns = useMemo(
    (): Map<string, GroupRunInfo> => computeGroupRuns(sortedEvents, itemKey, itemGroupIds),
    [sortedEvents, itemGroupIds],
  );

  // -------------------------------------------------------------------------
  // In-playlist filtering (Johannes #4/#12): analysis lens over the queue.
  // Text cards drop while filtering; a clip must match every active
  // dimension (AND across dimensions, OR within one).
  // -------------------------------------------------------------------------
  const filtersActive = queueFiltersActive(queueFilters);
  const activeFilterDims = [
    queueFilters.players, queueFilters.labelIds, queueFilters.eventTypes,
    queueFilters.periods, queueFilters.matchIds,
  ].filter((s) => s.size > 0).length;

  const filteredEvents = useMemo((): PlaybackItem[] => {
    if (!filtersActive) return sortedEvents;
    return sortedEvents.filter((item) => {
      if (isTextCard(item)) return false;
      const qi = item as QueueItem;
      const ev = qi.event;
      if (queueFilters.matchIds.size > 0 && !queueFilters.matchIds.has(qi.matchId)) return false;
      if (queueFilters.periods.size > 0 && !queueFilters.periods.has(String(ev.period))) return false;
      if (queueFilters.eventTypes.size > 0 && !queueFilters.eventTypes.has(eventLabel(ev))) return false;
      if (queueFilters.players.size > 0 && !queueFilters.players.has(playerName(ev))) return false;
      if (queueFilters.labelIds.size > 0) {
        const assigned = clipAssignments.get(`${qi.matchId}:${ev.eventId}`);
        if (!assigned || ![...queueFilters.labelIds].some((id) => assigned.has(id))) return false;
      }
      return true;
    });
  }, [sortedEvents, filtersActive, queueFilters, clipAssignments]);

  /** What the queue, playback, selection and export actually operate on. */
  const queueItems = filtersActive ? filteredEvents : sortedEvents;
  /** The rows on screen, in order: what focus moves over and ranges span. */
  const visibleKeys = useMemo(() => queueItems.map(itemKey), [queueItems]);
  const playableItems = queueItems;
  const playableKeys = visibleKeys;

  // Rows that leave the screen (a filter hid them, or they were removed)
  // leave the selection too, so a bulk remove never takes rows nobody can
  // see; focus and anchor let go of them the same way.
  useEffect(() => {
    setSelectedClipIds((prev) => pruneSelection(prev, visibleKeys) as Set<string>);
    const shown = new Set(visibleKeys);
    setFocusKey((key) => (key !== null && !shown.has(key) ? null : key));
    setAnchorKey((key) => (key !== null && !shown.has(key) ? null : key));
  }, [visibleKeys]);

  // Only offer filter options the open playlist actually contains.
  const queueFilterOptions = useMemo(() => {
    const players = new Set<string>();
    const types = new Set<string>();
    const periods = new Set<string>();
    const gameIds = new Set<string>();
    for (const item of sortedEvents) {
      if (isTextCard(item)) continue;
      const qi = item as QueueItem;
      const name = playerName(qi.event);
      if (name) players.add(name);
      types.add(eventLabel(qi.event));
      if (qi.event.period) periods.add(String(qi.event.period));
      gameIds.add(qi.matchId);
    }
    // Labels are one vocabulary (scope lives on the assignment) — the filter
    // matches either scope, so a plain alphabetical list is right.
    const sortedLabels = [...labels].sort((a, b) => a.name.localeCompare(b.name, "sv"));
    return {
      players: [...players].sort((a, b) => a.localeCompare(b, "sv")),
      labels: sortedLabels,
      eventTypes: [...types].sort().map((t) => ({ value: t, label: t })),
      periods: [...periods].sort(),
      games: [...gameIds].map((id) => ({ id, title: matchLookup.get(id)?.title ?? "Game" })),
    };
  }, [sortedEvents, labels, selected?.id, matchLookup]);

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  const handleStop = useCallback(() => {
    if (trimActiveRef.current) {
      trimActiveRef.current = false;
      setTrim(null);
    }
    queueRef.current = [];
    queueIdxRef.current = 0;
    setIsPlaying(false);
    setActiveEventId(null);
    setActiveTextCard(null);
    setCardPaused(false);
    clipEndRef.current = undefined;
    pendingSeekRef.current = null;
    if (textCardTimerRef.current) {
      clearTimeout(textCardTimerRef.current);
      textCardTimerRef.current = null;
    }
    videoRef.current?.pause();
  }, []);

  /**
   * The steppers and Reset: the playing clip's own length, applied to the
   * clip while it plays.
   */
  function adjustActiveClip(preDelta: number, postDelta: number) {
    if (!selected || !activeClipKey) return;
    const { matchId, eventId } = activeClipKey;
    const existingClip = clipByKey.get(`${matchId}:${eventId}`);
    const hundredths = (n: number) => Math.round(n * 100) / 100;
    const newPre = Math.max(-preRoll, hundredths((existingClip?.preRollOffset ?? 0) + preDelta));
    const newPost = Math.max(-postRoll, hundredths((existingClip?.postRollOffset ?? 0) + postDelta));
    void commitClipOffsets(matchId, eventId, newPre, newPost);
    const curQueueItem = queueRef.current[queueIdxRef.current];
    if (!curQueueItem || isTextCard(curQueueItem)) return;
    if (preDelta !== 0) {
      // A new start is worth seeing from the top.
      seekToItem(curQueueItem as QueueItem, newPre, newPost);
      return;
    }
    // Only the end moved: shorten or extend the running clip in place. A
    // restart here would make trimming the tail a stop-start exercise.
    const w = itemWindow(curQueueItem as QueueItem, newPre, newPost);
    if (w && clipEndRef.current !== undefined) clipEndRef.current = w.end;
  }

  /**
   * The one way a clip's own length changes (the steppers, Reset, a trim):
   * applied at once, saved, and put back with a toast if the save fails.
   * An upload recipients already have was cut at the old length, so it is
   * cleared and, in a shared playlist, made again with the new cut.
   */
  async function commitClipOffsets(matchId: string, eventId: number, pre: number, post: number) {
    const before = selectedRef.current;
    if (!before) return;
    const clip = before.items.filter(isClipItem).find((c) => c.matchId === matchId && c.eventId === eventId);
    if (!clip) return;
    const shippedUrl = clip.r2Url;
    const isThisClip = (c: PlaylistItem): c is PlaylistClipItem =>
      isClipItem(c) && c.matchId === matchId && c.eventId === eventId;
    const apply = (edit: (c: PlaylistClipItem) => PlaylistClipItem) => {
      const patch = (pl: Playlist): Playlist => ({ ...pl, items: pl.items.map((c) => (isThisClip(c) ? edit(c) : c)) });
      setSelected((prev) => (prev && prev.id === before.id ? patch(prev) : prev));
      if (selectedRef.current?.id === before.id) selectedRef.current = patch(selectedRef.current);
      setPlaylists((prev) => prev.map((p) => (p.id === before.id ? patch(p) : p)));
    };
    apply((c) => ({ ...c, preRollOffset: pre, postRollOffset: post, r2Url: undefined }));
    try {
      await updateClip(before.id, matchId, eventId, { preRollOffset: pre, postRollOffset: post });
    } catch (err) {
      // Put back only what this change set: a later one may have landed since.
      apply((c) =>
        (c.preRollOffset ?? 0) === pre && (c.postRollOffset ?? 0) === post
          ? { ...c, preRollOffset: clip.preRollOffset, postRollOffset: clip.postRollOffset, r2Url: shippedUrl }
          : c,
      );
      Sentry.captureException(err);
      toast.error("Couldn't save the clip's length");
      return;
    }
    const reship = () => queuePendingShip({ ...before, items: before.items.map((c) => (isThisClip(c) ? { ...c, r2Url: undefined } : c)) });
    if (!shippedUrl) {
      // Nothing was uploaded, or an upload is still running: the ship sorts
      // out what is missing or stale (see applyR2Urls).
      reship();
      return;
    }
    const clearUpload = async () => {
      try {
        await clearShippedClip(before.id, matchId, eventId, shippedUrl);
        reship();
      } catch (err) {
        apply((c) => (c.r2Url === undefined ? { ...c, r2Url: shippedUrl } : c));
        Sentry.captureException(err);
        toast.error("Recipients still see the old cut", {
          description: "The new length is saved, but the shared clip couldn't be replaced.",
          action: {
            label: "Try again",
            onClick: () => {
              apply((c) => ({ ...c, r2Url: undefined }));
              void clearUpload();
            },
          },
        });
      }
    };
    await clearUpload();
  }

  function saveClipNote(note: string) {
    if (!selected || activeEventId === null || activeMatchId === null) return;
    const matchId = activeMatchId;
    const newItems = selected.items.map((c) =>
      isClipItem(c) && c.matchId === matchId && c.eventId === activeEventId
        ? { ...c, note: note.trim() || undefined }
        : c
    );
    const updatedPlaylist = { ...selected, items: newItems };
    setSelected(updatedPlaylist);
    selectedRef.current = updatedPlaylist;
    setPlaylists((prev) => prev.map((p) => (p.id === selected.id ? updatedPlaylist : p)));
    updateClip(selected.id, matchId, activeEventId, { note: note.trim() || null }).catch(() => {});
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

  // The active clip's crop pan (vertical export) + its bounds in source-video
  // seconds — the keyframe strip and seek clamping need the window.
  const activeClipCrop = useMemo(() => {
    const empty = {
      keyframes: undefined as CropKeyframe[] | undefined,
      start: null as number | null,
      end: null as number | null,
    };
    if (!activeClipKey || !selected) return empty;
    const clip = selected.items.filter(isClipItem).find(
      (c) => c.matchId === activeClipKey.matchId && c.eventId === activeClipKey.eventId
    );
    const m = matchLookup.get(activeClipKey.matchId);
    const event = eventByKey.get(`${activeClipKey.matchId}:${activeClipKey.eventId}`);
    let start: number | null = null;
    let end: number | null = null;
    if (m?.syncPoint && event) {
      const t = computeVideoTime(event, m.syncPoint);
      if (t !== null) {
        const b = clipBounds(t, preRoll, postRoll, clip?.preRollOffset, clip?.postRollOffset);
        start = b.start;
        end = b.end;
      }
    }
    return { keyframes: clip?.cropKeyframes, start, end };
  }, [activeClipKey, selected, matchLookup, eventByKey, preRoll, postRoll]);

  /** Persist the active clip's crop pan — same optimistic shape as adjustActiveClip. */
  function setActiveClipCropKeyframes(kfs: CropKeyframe[] | null) {
    if (!selected || !activeClipKey) return;
    const newItems = selected.items.map((c) =>
      isClipItem(c) && c.matchId === activeClipKey.matchId && c.eventId === activeClipKey.eventId
        ? { ...c, cropKeyframes: kfs ?? undefined }
        : c
    );
    const updatedPlaylist = { ...selected, items: newItems };
    setSelected(updatedPlaylist);
    selectedRef.current = updatedPlaylist;
    setPlaylists((prev) => prev.map((p) => (p.id === selected.id ? updatedPlaylist : p)));
    updateClip(selected.id, activeClipKey.matchId, activeClipKey.eventId, { cropKeyframes: kfs }).catch(() => {});
  }

  function handleCropCommit(t: number, cx: number) {
    setActiveClipCropKeyframes(upsertKeyframe(activeClipCrop.keyframes, t, cx));
  }

  function handleCropRemoveAtPlayhead() {
    const kfs = activeClipCrop.keyframes;
    const video = videoRef.current;
    if (!kfs?.length || !video) return;
    const t = video.currentTime;
    let nearest = 0;
    for (let i = 1; i < kfs.length; i++) {
      if (Math.abs(kfs[i].t - t) < Math.abs(kfs[nearest].t - t)) nearest = i;
    }
    if (Math.abs(kfs[nearest].t - t) > 1.5) {
      toast.info("Jump to a keyframe dot first, then remove it");
      return;
    }
    const next = kfs.filter((_, i) => i !== nearest);
    setActiveClipCropKeyframes(next.length ? next : null);
  }

  function handleCropSeek(t: number) {
    const video = videoRef.current;
    if (!video) return;
    const { start, end } = activeClipCrop;
    // Stay inside the clip window — a hair short of the end so the
    // timeupdate auto-advance doesn't immediately fire.
    video.currentTime =
      start !== null && end !== null
        ? Math.min(Math.max(t, start), Math.max(start, end - 0.05))
        : t;
  }

  function getClipOffsets(matchId: string, eventId: number) {
    const clip = selectedRef.current?.items.filter(isClipItem).find(
      (c) => c.matchId === matchId && c.eventId === eventId
    );
    return { pre: clip?.preRollOffset ?? 0, post: clip?.postRollOffset ?? 0 };
  }

  /**
   * The stretch of video a queue item plays, from the clip's latest
   * offsets. clipBounds is also what exports and shipped clips are cut
   * with, so what plays is what goes out.
   */
  function itemWindow(item: QueueItem, preOverride?: number, postOverride?: number): { start: number; end: number } | null {
    const sp = matchLookupRef.current.get(item.matchId)?.syncPoint;
    if (!sp) return null;
    const videoTime = computeVideoTime(item.event, sp);
    if (videoTime === null) return null;
    const { pre, post } = getClipOffsets(item.matchId, item.event.eventId);
    return clipBounds(videoTime, preRollRef.current, postRollRef.current, preOverride ?? pre, postOverride ?? post);
  }

  /**
   * Seeks to a clip's start and plays it; at `end` the timeupdate handler
   * moves the queue on. While trimming nothing plays and nothing advances:
   * the seek only brings the clip into view.
   */
  function seekAndPlay(video: HTMLVideoElement, start: number, end: number) {
    clipEndRef.current = undefined;
    video.pause();
    function onSeeked() {
      // A seeked from an earlier, later jump: wait for this one.
      if (video.currentTime > start + 2) {
        video.addEventListener("seeked", onSeeked, { once: true });
        return;
      }
      if (trimActiveRef.current) return;
      clipEndRef.current = end;
      video.play().catch(() => {});
    }
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = start;
  }

  const seekToItem = useCallback((
    item: QueueItem,
    preOverride?: number,
    postOverride?: number,
  ) => {
    const video = videoRef.current;
    const w = itemWindow(item, preOverride, postOverride);
    if (!video || !w) return;
    seekAndPlay(video, w.start, w.end);
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
    setCardPaused(false);
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
        const w = itemWindow(clipItem);
        if (w) {
          if (clipItem.matchId !== activeMatchIdRef.current) {
            pendingSeekRef.current = { seekTo: w.start, clipEnd: w.end };
            setActiveMatchId(clipItem.matchId);
          } else if (videoRef.current) {
            seekAndPlay(videoRef.current, w.start, w.end);
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

  /** Shows a card on the stage; `hold` keeps it there until Play. */
  function startTextCard(card: PlaylistTextCard, hold = false) {
    setActiveEventId(null);
    setActiveTextCard(card);
    activeTextCardRef.current = card;
    videoRef.current?.pause();
    if (textCardTimerRef.current) clearTimeout(textCardTimerRef.current);
    textCardTimerRef.current = null;
    cardRemainingRef.current = card.durationSeconds * 1000;
    setCardPaused(hold);
    if (!hold) runCardTimer();
  }
  const startTextCardRef = useRef(startTextCard);
  startTextCardRef.current = startTextCard;

  function runCardTimer() {
    cardStartedAtRef.current = performance.now();
    textCardTimerRef.current = setTimeout(() => {
      textCardTimerRef.current = null;
      advanceFromTextCardRef.current();
    }, cardRemainingRef.current);
  }

  /** Holds the card on screen (editing it, or Space); the rest of its time waits. */
  function pauseCard() {
    if (!activeTextCardRef.current || !textCardTimerRef.current) return;
    clearTimeout(textCardTimerRef.current);
    textCardTimerRef.current = null;
    cardRemainingRef.current = Math.max(0, cardRemainingRef.current - (performance.now() - cardStartedAtRef.current));
    setCardPaused(true);
  }

  function resumeCard() {
    if (!activeTextCardRef.current || textCardTimerRef.current) return;
    setCardPaused(false);
    setIsPlaying(true);
    runCardTimer();
  }

  const toggleCard = () => (textCardTimerRef.current ? pauseCard() : resumeCard());
  const toggleCardRef = useRef(toggleCard);
  toggleCardRef.current = toggleCard;

  // Auto-advance via timeupdate — re-binds when video source changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function handleTimeUpdate() {
      const end = clipEndRef.current;
      if (end === undefined || !video || trimActiveRef.current) return;
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
          const w = itemWindow(clipItem);
          if (w) {
            if (clipItem.matchId !== activeMatchIdRef.current) {
              pendingSeekRef.current = { seekTo: w.start, clipEnd: w.end };
              setActiveMatchId(clipItem.matchId);
            } else {
              seekAndPlay(video, w.start, w.end);
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

  function startQueue(queue: PlaybackItem[], holdFirstCard = false) {
    if (queue.length === 0) return;
    abandonTrim();
    const firstItem = queue[0];
    queueRef.current = queue;
    queueIdxRef.current = 0;
    setIsPlaying(true);
    if (isTextCard(firstItem)) {
      startTextCardRef.current(firstItem as PlaylistTextCard, holdFirstCard);
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
    setCardPaused(false);
    activeTextCardRef.current = null;
    setActiveEventId(clipItem.event.eventId);
    if (clipItem.matchId !== activeMatchIdRef.current) {
      const w = itemWindow(clipItem);
      if (w) pendingSeekRef.current = { seekTo: w.start, clipEnd: w.end };
      setActiveMatchId(clipItem.matchId);
    } else {
      seekToItem(clipItem);
    }
  }

  function handleRowClick(item: PlaybackItem) {
    const idx = queueItems.findIndex((i) => itemKey(i) === itemKey(item));
    const queue = idx >= 0 ? queueItems.slice(idx) : [item];
    // A card shows held, so it can be read and edited; Play carries on from it.
    startQueue(queue, isTextCard(item));
  }

  const _sortedEventsRef = useRef(playableItems);
  _sortedEventsRef.current = playableItems;
  const _activeKeyRef = useRef(activeKey);
  _activeKeyRef.current = activeKey;
  const _handleRowClickRef = useRef(handleRowClick);
  _handleRowClickRef.current = handleRowClick;
  const _handleReplayRef = useRef(handleReplay);
  _handleReplayRef.current = handleReplay;

  const listPosition = useMemo(
    () => (activeKey === null ? -1 : playableKeys.indexOf(activeKey)),
    [activeKey, playableKeys],
  );
  const canPrev = listPosition > 0;
  const canNext = listPosition >= 0 && listPosition < playableItems.length - 1;

  const handlePrev = useCallback(() => {
    const items = _sortedEventsRef.current;
    const cur = items.findIndex((i) => itemKey(i) === _activeKeyRef.current);
    if (cur <= 0) return;
    _handleRowClickRef.current(items[cur - 1]);
  }, []);

  const handleNext = useCallback(() => {
    const items = _sortedEventsRef.current;
    const cur = items.findIndex((i) => itemKey(i) === _activeKeyRef.current);
    if (cur === -1 || cur >= items.length - 1) return;
    _handleRowClickRef.current(items[cur + 1]);
  }, []);

  // Whatever starts playing (a click, the arrows, the queue moving on)
  // becomes the row the keys work from.
  useEffect(() => {
    if (activeKey === null) return;
    setFocusKey(activeKey);
    setAnchorKey(activeKey);
  }, [activeKey]);

  // Keep the focused row in view. Looked up inside the list only: the Add
  // Clips sheet renders rows for the same clips.
  useEffect(() => {
    if (focusKey === null) return;
    findRow(gridRef.current, focusKey)?.scrollIntoView({ block: "nearest" });
  }, [focusKey]);

  // The ring goes at the next pointer press anywhere.
  useEffect(() => {
    if (!keyboardNav) return;
    const off = () => setKeyboardNav(false);
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [keyboardNav]);

  // How the latest input came: a press moves focus to the grid by script,
  // and WebKit can call that :focus-visible, so the grid asks this instead.
  const lastInputRef = useRef<"pointer" | "keyboard">("pointer");
  useEffect(() => {
    const onPointer = () => { lastInputRef.current = "pointer"; };
    const onKey = () => { lastInputRef.current = "keyboard"; };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  /** Moves focus with the arrows (and plays there, as a plain arrow always has). */
  function moveListFocus(move: FocusMove) {
    const to = moveFocus(visibleKeys, focusKey ?? activeKey, move);
    if (to === null) return;
    setKeyboardNav(true);
    setFocusKey(to);
    setAnchorKey(to);
    if (to === activeKey) return;
    const item = queueItems.find((i) => itemKey(i) === to);
    if (item) handleRowClick(item);
  }

  /** Shift+arrows: the range from the anchor follows focus, nothing plays. */
  function extendListFocus(move: FocusMove) {
    const from = focusKey ?? activeKey;
    const to = moveFocus(visibleKeys, from, move);
    if (to === null) return;
    const shown = (key: string | null): key is string => key !== null && visibleKeys.includes(key);
    const anchor = shown(anchorKey) ? anchorKey : shown(from) ? from : to;
    setSelectedClipIds((prev) =>
      extendSelection({ order: visibleKeys, selected: prev, anchor, previousFocus: shown(from) ? from : null, focus: to }),
    );
    setKeyboardNav(true);
    setAnchorKey(anchor);
    setFocusKey(to);
  }

  /**
   * A click on a row: plain plays it (and lets go of the selection when the row
   * isn't in it), ⌘ toggles it, Shift selects the range from the anchor.
   */
  function handleRowPress(item: PlaybackItem, e: React.MouseEvent) {
    const key = itemKey(item);
    const shift = e.shiftKey;
    const toggle = e.metaKey || e.ctrlKey;
    gridRef.current?.focus({ preventScroll: true });
    applyClickSelection(key, shift, toggle);
    if (!shift && !toggle) handleRowClick(item);
  }

  /** The row's checkbox: a toggle, or with Shift the range from the anchor. */
  function handleRowCheckbox(key: string, e: React.MouseEvent) {
    e.stopPropagation();
    applyClickSelection(key, e.shiftKey, !e.shiftKey);
  }

  function applyClickSelection(key: string, shift: boolean, toggle: boolean) {
    const next = clickSelection({
      order: visibleKeys,
      selected: selectedClipIds,
      anchor: anchorKey,
      focus: focusKey,
      key,
      shift,
      toggle,
    });
    // A plain click inside the selection keeps it: same rows, no re-render of every row.
    const same = next.selected.size === selectedClipIds.size && [...next.selected].every((k) => selectedClipIds.has(k));
    if (!same) setSelectedClipIds(next.selected);
    setAnchorKey(next.anchor);
    setFocusKey(next.focus);
  }

  /** Delete with nothing selected: the focused row goes, with Undo. */
  function removeFocusedRow() {
    if (!selected || focusKey === null) return;
    const item = selected.items.find((i) => playlistItemKey(i) === focusKey);
    if (!item) return;
    const after = focusAfterRemoval(visibleKeys, new Set([focusKey]), focusKey);
    setFocusKey(after);
    setAnchorKey(after);
    if (isClipItem(item)) handleRemoveSingleClip(item);
    else handleRemoveSingleTextCard(item as PlaylistTextCard);
  }

  /**
   * Shift+F10 (or the menu key): the focused row's context menu, opened the
   * way a right-click opens it, at the row's leading edge.
   */
  function openFocusedRowMenu() {
    if (focusKey === null) return;
    const row = findRow(gridRef.current, focusKey);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    const r = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: r.left + 40,
        clientY: r.top + r.height / 2,
      }),
    );
  }

  /** T, the Trim button, or a row's "Trim clip…": the playing clip's ends on handles. */
  function startTrim() {
    if (trimActiveRef.current || !selected || !activeClipKey || activeTextCard || playerFs.active || cropMode) return;
    const { matchId, eventId } = activeClipKey;
    const sync = matchLookup.get(matchId)?.syncPoint;
    const event = eventByKey.get(`${matchId}:${eventId}`);
    const eventTime = sync && event ? computeVideoTime(event, sync) : null;
    if (eventTime === null) return;
    const clip = clipByKey.get(`${matchId}:${eventId}`);
    const { start, end } = clipBounds(eventTime, preRoll, postRoll, clip?.preRollOffset, clip?.postRollOffset);
    // Set now, not at the next render: a seek landing meanwhile must not play.
    trimActiveRef.current = true;
    clipEndRef.current = undefined;
    videoRef.current?.pause();
    setTrim({ key: `${matchId}:${eventId}`, matchId, eventId, eventTime, start, end });
  }

  /** Something else took over (another clip, Stop, full screen): trim mode just closes. */
  function abandonTrim() {
    if (!trimActiveRef.current) return;
    trimActiveRef.current = false;
    setTrim(null);
  }

  /**
   * Done (with the new ends) or Cancel (null). Either way the clip stays,
   * paused at its start: Space plays the result and the queue carries on
   * after it.
   */
  function endTrim(result: TrimWindow | null) {
    const tr = trim;
    if (!tr) return;
    trimActiveRef.current = false;
    setTrim(null);
    let window = { start: tr.start, end: tr.end };
    const inChanged = !!result && Math.abs(result.start - tr.start) >= 0.05;
    const outChanged = !!result && Math.abs(result.end - tr.end) >= 0.05;
    if (result && (inChanged || outChanged)) {
      const offsets = offsetsForTrim({ eventTime: tr.eventTime, start: result.start, end: result.end, preRoll, postRoll });
      void commitClipOffsets(tr.matchId, tr.eventId, offsets.preRollOffset, offsets.postRollOffset);
      window = clipBounds(tr.eventTime, preRoll, postRoll, offsets.preRollOffset, offsets.postRollOffset);
      trackEvent("clip_trimmed", {
        playlist_id: selected?.id,
        in_changed: inChanged,
        out_changed: outChanged,
        length_seconds: Math.round((window.end - window.start) * 10) / 10,
      });
    }
    const video = videoRef.current;
    if (video && activeKey === tr.key) {
      video.pause();
      video.currentTime = window.start;
      clipEndRef.current = window.end;
    }
  }

  /** A row's "Trim clip…": that clip plays (paused) and opens for trimming. */
  function trimRow(item: QueueItem) {
    const key = itemKey(item);
    if (key === activeKey) {
      startTrim();
      return;
    }
    pendingTrimKeyRef.current = key;
    handleRowClick(item);
  }

  useEffect(() => {
    if (pendingTrimKeyRef.current === null) return;
    if (pendingTrimKeyRef.current === activeKey) {
      pendingTrimKeyRef.current = null;
      startTrim();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  // Trim belongs to one clip in the window: another clip, full screen or
  // the crop editor closes it.
  useEffect(() => {
    if (trim && (activeKey !== trim.key || playerFs.active || cropMode)) abandonTrim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, playerFs.active, cropMode]);

  // One key owner for the page (src/lib/key-scope.ts); the Add Clips sheet
  // registers its own scope on top while it is open. The handler closes
  // over the latest render, so no refs are needed for state.
  useKeyScope("editor", !reportView);
  useHotkeys("editor", (e) => {
    // Edit shortcuts for the rows. A text field keeps its own (useHotkeys skips fields), and so
    // does text selected on the page for ⌘C.
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const textSelected = !!window.getSelection()?.toString();
      const done =
        k === "z" ? stepHistory(e.shiftKey ? "redo" : "undo")
        : k === "y" && !IS_MACOS && !e.shiftKey ? stepHistory("redo")
        : (k === "c" || k === "x") && !e.shiftKey && !textSelected ? copyRows(k === "x")
        : k === "v" && !e.shiftKey ? pasteRows()
        : false;
      if (done) {
        e.preventDefault();
        return;
      }
    }
    // ⌘. is the Mac's "stop what's running": here, a Save to computer render.
    if ((e.metaKey || e.ctrlKey) && e.key === "." && isExporting) {
      e.preventDefault();
      stopExport();
      return;
    }
    const action = resolvePlayerKey(e);
    if (!action) return;
    const video = videoRef.current;
    const nudge = (delta: number) => {
      if (!video || activeClipCrop.start === null || activeClipCrop.end === null) return;
      video.currentTime = clamp(
        video.currentTime + delta,
        activeClipCrop.start,
        Math.max(activeClipCrop.start, activeClipCrop.end - 0.05),
      );
    };
    switch (action) {
      case "fullscreen":
        e.preventDefault();
        toggleFullscreen();
        return;
      case "escape":
        // Dialogs own their Escape. A bare fullscreen layer exits here
        // (macOS may have already dropped native fullscreen itself — this
        // closes the CSS layer; the hook's poll reconciles the window);
        // otherwise Escape lets go of the selection.
        if (document.querySelector('[role="dialog"]')) return;
        if (playerFsRef.current.active) {
          e.preventDefault();
          void playerFsRef.current.exit();
          return;
        }
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          setSelectedClipIds(new Set());
        }
        return;
      case "replay":
        e.preventDefault();
        _handleReplayRef.current();
        return;
      case "trim":
        if (!activeClipKey) return;
        e.preventDefault();
        startTrim();
        return;
      case "toggle-mute":
        e.preventDefault();
        togglePlayerMuted({ announce: true });
        return;
      case "toggle-play": {
        e.preventDefault();
        if (activeTextCardRef.current) {
          toggleCardRef.current();
          return;
        }
        if (!video) return;
        if (activeEventId === null && activeTextCard === null && video.paused) {
          if (queueItems.length > 0) startQueue(queueItems);
          return;
        }
        if (video.paused) video.play().catch(() => {});
        else video.pause();
        return;
      }
      case "nudge-back":
        e.preventDefault();
        nudge(-NUDGE_SECONDS);
        return;
      case "nudge-forward":
        e.preventDefault();
        nudge(NUDGE_SECONDS);
        return;
      case "nudge-back-far":
        e.preventDefault();
        nudge(-NUDGE_FAR_SECONDS);
        return;
      case "nudge-forward-far":
        e.preventDefault();
        nudge(NUDGE_FAR_SECONDS);
        return;
      case "shuttle-pause":
        e.preventDefault();
        video?.pause();
        return;
      case "shuttle-forward": {
        e.preventDefault();
        if (!video) return;
        setPlaybackSpeed(nextShuttleRate(playbackSpeed));
        if (video.paused) video.play().catch(() => {});
        return;
      }
      case "shuttle-back":
        // WebKit has no reverse playback; stepping back is the honest version.
        e.preventDefault();
        nudge(-5);
        return;
      case "remove":
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          void handleRemoveSelected();
          return;
        }
        // Only a row the ring is showing on: a stray Delete never takes a
        // clip nobody saw was focused.
        if (!keyboardNav || focusKey === null) return;
        e.preventDefault();
        removeFocusedRow();
        return;
      case "select-all":
        if (queueItems.length === 0) return;
        e.preventDefault();
        setSelectedClipIds(new Set(visibleKeys));
        return;
      case "next":
      case "prev":
      case "first":
      case "last":
        if (visibleKeys.length === 0) return;
        e.preventDefault();
        moveListFocus(action === "next" ? 1 : action === "prev" ? -1 : action);
        return;
      case "extend-next":
      case "extend-prev":
      case "extend-first":
      case "extend-last":
        if (visibleKeys.length === 0) return;
        e.preventDefault();
        extendListFocus(
          action === "extend-next" ? 1 : action === "extend-prev" ? -1 : action === "extend-first" ? "first" : "last",
        );
        return;
      case "play-focused":
      case "row-menu": {
        // Return and the menu key belong to whatever has focus, a toolbar
        // button say; the list answers only when it has focus itself (or
        // nothing does).
        const fromList = e.target === document.body || e.target === gridRef.current;
        if (!fromList || focusKey === null) return;
        e.preventDefault();
        if (action === "row-menu") {
          openFocusedRowMenu();
          return;
        }
        const item = queueItems.find((i) => itemKey(i) === focusKey);
        if (item) handleRowClick(item);
        return;
      }
    }
  });

  useEffect(() => {
    if (!newlyInsertedCardId) return;
    findRow(gridRef.current, `text:${newlyInsertedCardId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setNewlyInsertedCardId(null);
  }, [newlyInsertedCardId, sortedEvents]);

  // Back from the report with "Open in playlist": that clip is the focused, selected row.
  useEffect(() => {
    const key = pendingRevealKeyRef.current;
    if (reportView || !key) return;
    pendingRevealKeyRef.current = null;
    if (!visibleKeys.includes(key)) return;
    setFocusKey(key);
    setAnchorKey(key);
    setSelectedClipIds(new Set([key]));
    setKeyboardNav(true);
    requestAnimationFrame(() => findRow(gridRef.current, key)?.scrollIntoView({ block: "center" }));
  }, [reportView, visibleKeys]);

  /** Map display items back to PlaylistItems, preserving all original fields (incl. groupId). */
  function mapDisplayToItems(newDisplayItems: PlaybackItem[]): PlaylistItem[] {
    if (!selected) return [];
    const clipMap = new Map(
      selected.items.filter(isClipItem).map((c) => [`${c.matchId}:${c.eventId}`, c])
    );
    const textCardMap = new Map(
      selected.items.filter((i) => !isClipItem(i)).map((c) => [(c as PlaylistTextCard).id, c as PlaylistTextCard])
    );
    return newDisplayItems.map((item) => {
      if (isTextCard(item)) return textCardMap.get((item as PlaylistTextCard).id) ?? item as PlaylistTextCard;
      const qi = item as QueueItem;
      return clipMap.get(`${qi.matchId}:${qi.event.eventId}`) ?? { type: 'clip' as const, matchId: qi.matchId, eventId: qi.event.eventId };
    });
  }

  /** A new order or new groups (a move, Group, Ungroup): shown at once, saved in order, undoable. */
  async function applyItemsUpdate(newItems: PlaylistItem[], label = "Move") {
    if (!selected) return;
    await commitItemsEdit(selected, newItems, label);
  }

  async function handleReorder(newDisplayItems: PlaybackItem[]) {
    if (!selected) return;
    await applyItemsUpdate(mapDisplayToItems(newDisplayItems));
  }

  // ---------------------------------------------------------------------------
  // Clip groups (Johannes #7): lock items together so they reorder as a unit
  // ---------------------------------------------------------------------------

  async function handleGroupSelected() {
    if (!selected || filtersActive) return;
    const displayKeys = sortedEvents.map(itemKey);
    const displayKeySet = new Set(displayKeys);
    const seed = new Set([...selectedClipIds].filter((k) => displayKeySet.has(k)));
    if (seed.size < 2) return;
    // Groups are atomic: grouping a selection that touches an existing group
    // absorbs that whole group into the new one.
    const absorbedGids = new Set<string>();
    for (const k of seed) {
      const g = itemGroupIds.get(k);
      if (g) absorbedGids.add(g);
    }
    const memberKeys = new Set(
      displayKeys.filter((k) => seed.has(k) || absorbedGids.has(itemGroupIds.get(k) ?? ""))
    );
    const blockIndices = displayKeys
      .map((k, i) => (memberKeys.has(k) ? i : -1))
      .filter((i) => i >= 0);
    // Pull-together semantics: the block lands at the first member's display
    // position (no earlier block index exists before that gap, so moveBlock
    // keeps the first member in place and pulls the rest up behind it).
    const newDisplay = moveBlock(sortedEvents, blockIndices, blockIndices[0]);
    const newGroupId = crypto.randomUUID();
    const newItems = normalizeGroups(
      mapDisplayToItems(newDisplay).map((it) =>
        memberKeys.has(playlistItemKey(it)) ? { ...it, groupId: newGroupId } : it
      )
    );
    // Grouping materializes the visible order, same as a manual drag would.
    setClockSort("none");
    setSelectedClipIds(new Set());
    trackEvent("clips_grouped", { playlist_id: selected.id, clip_count: memberKeys.size });
    await applyItemsUpdate(newItems, "Group");
  }

  async function handleUngroup(groupId: string) {
    if (!selected || filtersActive) return;
    const clipCount = selected.items.filter((it) => it.groupId === groupId).length;
    const newItems = selected.items.map((it) => {
      if (it.groupId !== groupId) return it;
      const { groupId: _g, ...rest } = it;
      return rest as PlaylistItem;
    });
    await applyItemsUpdate(newItems, "Ungroup");
    trackEvent("clips_ungrouped", { clip_count: clipCount });
  }

  // ---------------------------------------------------------------------------
  // Clip drag: pointer-driven, 1:1 (src/components/editor/use-list-drag.ts).
  // The engine owns the lifted card and the row shifts; the page owns what a
  // drop means and the browser column's spring-loading.
  // ---------------------------------------------------------------------------

  const reducedMotion = useReducedMotionSafe();

  /** Reset every piece of hover and spring-load state once a drag is over. */
  function endClipDragBookkeeping() {
    if (clipDragFolderExpandTimerRef.current) {
      clearTimeout(clipDragFolderExpandTimerRef.current);
      clipDragFolderExpandTimerRef.current = null;
    }
    if (clipDragPlaylistOpenTimerRef.current) {
      clearTimeout(clipDragPlaylistOpenTimerRef.current);
      clipDragPlaylistOpenTimerRef.current = null;
    }
    clipDragOverPlaylistIdRef.current = null;
    clipDragOverFolderIdRef.current = null;
    setClipDropGap(null);
    setClipDragOverPlaylistId(null);
    setClipExpandFolderId(null);
    setClipOpenPlaylistId(null);
  }

  function handleDragTarget(target: DragTarget) {
    setClipDropGap(target.kind === "list" ? target.gap : null);

    // Hovering a playlist highlights it and, after a beat, opens it so the
    // clip can be placed inside (the drag carries on as a foreign drop).
    const playlistId = target.kind === "playlist" ? target.id : null;
    if (playlistId !== clipDragOverPlaylistIdRef.current) {
      clipDragOverPlaylistIdRef.current = playlistId;
      if (clipDragPlaylistOpenTimerRef.current) {
        clearTimeout(clipDragPlaylistOpenTimerRef.current);
        clipDragPlaylistOpenTimerRef.current = null;
      }
      setClipOpenPlaylistId(null);
      setClipDragOverPlaylistId(playlistId);
      if (playlistId && selectedRef.current?.id !== playlistId) {
        const pl = playlistsRef.current.find((p) => p.id === playlistId);
        if (pl) {
          setClipOpenPlaylistId(playlistId);
          clipDragPlaylistOpenTimerRef.current = setTimeout(() => {
            clipDragPlaylistOpenTimerRef.current = null;
            setClipOpenPlaylistId(null);
            selectPlaylist(pl);
          }, 600);
        }
      }
    }

    // Hovering a collapsed folder (or the Uncategorized section) opens it.
    const folderId = target.kind === "folder" ? target.id : null;
    if (folderId !== clipDragOverFolderIdRef.current) {
      clipDragOverFolderIdRef.current = folderId;
      if (clipDragFolderExpandTimerRef.current) {
        clearTimeout(clipDragFolderExpandTimerRef.current);
        clipDragFolderExpandTimerRef.current = null;
      }
      setClipExpandFolderId(null);
      const collapsed =
        folderId === "uncategorized"
          ? !uncategorizedExpandedRef.current
          : folderId !== null && !expandedFoldersRef.current.has(folderId);
      if (folderId && collapsed) {
        setClipExpandFolderId(folderId);
        clipDragFolderExpandTimerRef.current = setTimeout(() => {
          clipDragFolderExpandTimerRef.current = null;
          setClipExpandFolderId(null);
          if (folderId === "uncategorized") setUncategorizedExpanded(true);
          else setExpandedFolders((prev) => new Set([...prev, folderId]));
        }, 600);
      }
    }
  }

  /** A block dropped back into its own list: persist the order on screen. */
  function commitReorder(gap: number, blockKeys: readonly string[]) {
    if (!selected) return;
    const keySet = new Set(blockKeys);
    const blockIndices: number[] = [];
    sortedEvents.forEach((it, i) => {
      if (keySet.has(itemKey(it))) blockIndices.push(i);
    });
    if (blockIndices.length === 0) return;
    const next = moveBlock(sortedEvents, blockIndices, gap);
    if (isSameOrder(next, sortedEvents, itemKey)) return;
    // A manual move materialises whatever order was on screen.
    setClockSort("none");
    void handleReorder(next);
  }

  /**
   * A clip carried in from another playlist (the drag spring-loaded into
   * this one). Foreign clips never enter a group implicitly: they land at
   * the nearest group boundary. The optimistic row is pulled back if the
   * add fails.
   */
  function commitForeignDrop(key: string, rawGap: number) {
    if (!selected) return;
    if (key.startsWith("text:")) return; // text cards don't migrate
    const insertIndex = snapGapToGroupBoundary(rawGap, sortedEvents, itemKey, itemGroupIds, new Set());
    const colonIdx = key.indexOf(":");
    const matchId = key.slice(0, colonIdx);
    const eventId = Number(key.slice(colonIdx + 1));
    const isSame = (c: PlaylistClipItem) => c.matchId === matchId && c.eventId === eventId;
    if (selected.items.filter(isClipItem).some(isSame)) return;
    const itemsInsertIndex = itemsIndexForGap(
      insertIndex,
      sortedEvents.map(itemKey),
      selected.items.map(playlistItemKey),
    );
    const newClip: PlaylistClipItem = { type: "clip", matchId, eventId };
    const newItems = [...selected.items];
    newItems.splice(itemsInsertIndex, 0, newClip);
    const target = selected;
    trackEvent("clip_added_to_playlist", { playlist_id: target.id, match_id: matchId });
    // Shipping is armed once the row exists, so updateClipR2Url has something to patch.
    void commitItemsEdit(target, newItems, "Add clip").then((ok) => {
      if (ok) queuePendingShip(target);
    });
  }

  const listDrag = useListDrag({
    listRef: playlistScrollRef,
    sidebarRef: sidebarScrollRef,
    reducedMotion,
    canStart: () => {
      // Reordering a filtered (partial) list is ambiguous — locked until cleared.
      if (filtersActive) {
        toast("Clear the filters to reorder");
        return false;
      }
      return true;
    },
    blockFor: (anchorKey) => dragBlockKeys(anchorKey, selectedClipIds, sortedEvents.map(itemKey), itemGroupIds),
    snapGap: (gap, blockKeys) => snapGapToGroupBoundary(gap, sortedEvents, itemKey, itemGroupIds, new Set(blockKeys)),
    onTarget: handleDragTarget,
    onDrop: ({ gap, blockKeys, anchorKey, foreign }) => {
      if (foreign) commitForeignDrop(anchorKey, gap);
      else commitReorder(gap, blockKeys);
    },
    onDropOnPlaylist: (playlistId, anchorKey) => void handleClipDropOnPlaylist(playlistId, anchorKey),
    onEnd: endClipDragBookkeeping,
    focusRef: gridRef,
  });

  // The list under a drag changed (spring-loaded into another playlist):
  // the engine re-measures and carries the clip across as a foreign drop.
  useEffect(() => {
    listDrag.invalidate();
  }, [selected?.id, listDrag]);

  async function handleClipDropOnPlaylist(targetPlaylistId: string, clipKey: string) {
    // Text cards can't be dropped onto other playlists
    if (clipKey.startsWith("text:")) return;
    const colonIdx = clipKey.indexOf(":");
    const matchId = clipKey.slice(0, colonIdx);
    const eventId = Number(clipKey.slice(colonIdx + 1));
    const target = playlists.find((p) => p.id === targetPlaylistId);
    if (!target) { endClipDragBookkeeping(); return; }
    if (target.items.filter(isClipItem).some((c) => c.matchId === matchId && c.eventId === eventId)) {
      endClipDragBookkeeping();
      return;
    }
    const found = selected?.items.filter(isClipItem).find((c) => c.matchId === matchId && c.eventId === eventId);
    // Copies never carry group membership into the target playlist.
    const { groupId: _g, ...cleanClip } = found ?? { type: 'clip' as const, matchId, eventId };
    const sourceClip = cleanClip as PlaylistClipItem;
    // The membership check above reads state that only updates once the await
    // below resolves, so two quick drops of the same clip both pass it.
    const inFlightKey = `${targetPlaylistId}:${clipKey}`;
    if (clipAddInFlightRef.current.has(inFlightKey)) { endClipDragBookkeeping(); return; }
    clipAddInFlightRef.current.add(inFlightKey);
    // Synchronously end the drag bookkeeping before the await — guarantees the
    // RAF/window listener can't keep firing while we await the network call,
    // even if dragend never reaches the (possibly unmounted) source row.
    endClipDragBookkeeping();
    try {
      await addClips(targetPlaylistId, [sourceClip], target.items.length);
    } catch (err) {
      console.error("[playlists] Failed to add dropped clip to playlist:", err);
      Sentry.captureException(err);
      toast.error("Couldn't add the clip");
      return;
    } finally {
      clipAddInFlightRef.current.delete(inFlightKey);
    }
    trackEvent('clip_added_to_playlist', { playlist_id: targetPlaylistId, match_id: matchId })
    // Derived from prev, not a pre-await snapshot: a concurrent add to the same
    // playlist would otherwise be dropped from optimistic state.
    const appendClip = (items: PlaylistItem[]): PlaylistItem[] =>
      items.filter(isClipItem).some((c) => c.matchId === matchId && c.eventId === eventId)
        ? items
        : [...items, sourceClip];
    setPlaylists((prev) => prev.map((p) => p.id === targetPlaylistId ? { ...p, items: appendClip(p.items) } : p));
    if (selected?.id === targetPlaylistId) setSelected((prev) => prev ? { ...prev, items: appendClip(prev.items) } : prev);
    // A clip dragged into an already-shared playlist must ship like any other add.
    queuePendingShip(target);
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /** Segments for export / send-to-phone — honors the current selection. */
  function buildExportSegments(): ExportSegment[] {
    const itemsToExport = selectedClipIds.size > 0
      ? queueItems.filter(item => selectedClipIds.has(itemKey(item)))
      : queueItems;

    return itemsToExport
      .map((item): ExportSegment | null => {
        if (isTextCard(item)) {
          const card = item as PlaylistTextCard;
          return { kind: 'text', text: card.text, durationSeconds: card.durationSeconds, ...(card.card ? { card: card.card } : {}) };
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
        if (clip?.cropKeyframes) (seg as Extract<ExportSegment, { kind: 'clip' }>).cropKeyframes = clip.cropKeyframes;
        return seg;
      })
      .filter((x): x is ExportSegment => x !== null);
  }

  function handleSendToPhone(vertical = false) {
    if (!exportAllowed) {
      setUpgradeDialogOpen(true);
      return;
    }
    setSendToPhoneVertical(vertical);
    setSendToPhoneSegments(buildExportSegments());
    setSendToPhoneOpen(true);
  }

  /**
   * Both export verbs go through the format step — free plan included: the
   * picker shows what exporting offers (incl. vertical), and the upsell
   * fires AFTER the format pick, when intent is fully expressed. The gates
   * inside handleExport/handleSendToPhone are what stop the free path.
   */
  function openExportPicker(action: ExportAction) {
    setExportFormatAction(action);
  }

  function handleFormatPicked(format: "16:9" | "9:16") {
    const action = exportFormatAction;
    setExportFormatAction(null);
    if (!action) return;
    // Remember what was asked for so the upgrade dialog (if the plan gate
    // trips) names the action and tracks the wanted format.
    setUpsellContext({ action, format });
    const vertical = format === "9:16";
    if (action === "save") void handleExport(vertical);
    else handleSendToPhone(vertical);
  }

  // Pan coverage for the format dialog — same set buildExportSegments uses.
  const exportPanCounts = useMemo(() => {
    const itemsToExport = selectedClipIds.size > 0
      ? queueItems.filter((item) => selectedClipIds.has(itemKey(item)))
      : queueItems;
    const clips = itemsToExport.filter((i): i is QueueItem => !isTextCard(i));
    const byKey = new Map(
      (selected?.items.filter(isClipItem) ?? []).map((c) => [`${c.matchId}:${c.eventId}`, c])
    );
    const panned = clips.filter(
      (qi) => (byKey.get(`${qi.matchId}:${qi.event.eventId}`)?.cropKeyframes?.length ?? 0) > 0
    ).length;
    return { panned, total: clips.length };
  }, [selectedClipIds, queueItems, selected]);

  async function handleExport(vertical = false) {
    if (!exportAllowed) {
      setUpgradeDialogOpen(true);
      return;
    }
    setExportError(null);
    setExportProgress(null);
    const abort = new AbortController();
    exportAbortRef.current = abort;
    let segmentCount = 0;
    try {
      const segments = buildExportSegments();
      segmentCount = segments.filter(s => s.kind === 'clip').length;
      // Watermark policy: rookie exports always carry it (public tapes are
      // the growth loop); pro/franchise may disable it in Settings.
      const canDisableWatermark = activeOrgPlan === 'pro' || activeOrgPlan === 'franchise';
      const watermark = !(canDisableWatermark && getExportWatermarkDisabled());
      const exportedPath = await exportPlaylist(segments, preRoll, postRoll, selected!.name, watermark, vertical, {
        onProgress: setExportProgress,
        signal: abort.signal,
        // "Exporting…" only once the save panel has a path: not while it is open.
        onPathChosen: () => setIsExporting(true),
      });
      if (exportedPath) {
        notifyExportSuccess(exportedPath);
        trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'success', selection_only: selectedClipIds.size > 0, stats_cards: segments.filter((seg) => seg.kind === 'text' && seg.card).length, ...(vertical ? { aspect: '9:16' } : {}) });
        // Completes the Getting Started "export a playlist" step (local-only
        // is fine — the checklist is a first-session aid, not a record).
        setHasExported(user?.id);
        window.dispatchEvent(new CustomEvent("playlist-exported"));
      }
    } catch (e) {
      if (isExportCancelled(e)) {
        toast("Export stopped");
        trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'cancelled' });
      } else {
        setExportError(e instanceof Error ? e.message : String(e));
        trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      }
    } finally {
      if (exportAbortRef.current === abort) exportAbortRef.current = null;
      setIsExporting(false);
      setExportProgress(null);
    }
  }

  /** Stops a Save to computer render where it is (toolbar ⓧ, or ⌘.). */
  function stopExport() {
    exportAbortRef.current?.abort();
  }

  // ---------------------------------------------------------------------------
  // Clip & Ship
  // ---------------------------------------------------------------------------

  /** Segments for shipping/exporting the given playlist's clips. */
  /** Shared playlists need every clip in the cloud — recipients can't see unshipped clips. */
  function playlistIsShared(pl: Playlist): boolean {
    return (pl.teamIds?.length ?? 0) > 0 || (pl.userIds?.length ?? 0) > 0;
  }

  /** Arm a deferred ship for a shared playlist; the watcher effect picks it up. */
  function queuePendingShip(pl: Playlist) {
    if (!playlistIsShared(pl)) return;
    pendingShipRef.current.add(pl.id);
    setShipNonce((n) => n + 1); // ref writes don't re-render — wake the watcher
  }

  // Built from pl.items (not the selected playlist's queue) so a deferred
  // ship stays correct when the coach has switched focus to another playlist.
  // Upload order doesn't matter, so no sort is applied.
  function buildShipSegments(pl: Playlist): ExportSegment[] {
    return pl.items
      .filter(isClipItem)
      .map((clip): ExportSegment | null => {
        const m = matchLookup.get(clip.matchId);
        if (!m?.videoUrl || !m.syncPoint) return null;
        const event = eventByKey.get(`${clip.matchId}:${clip.eventId}`);
        if (!event) return null;
        const seg: ExportSegment = {
          kind: "clip",
          videoPath: m.videoUrl,
          matchId: clip.matchId,
          event,
          syncPoint: m.syncPoint,
        };
        if (clip.preRollOffset !== undefined)
          (seg as Extract<ExportSegment, { kind: "clip" }>).preRollOffset = clip.preRollOffset;
        if (clip.postRollOffset !== undefined)
          (seg as Extract<ExportSegment, { kind: "clip" }>).postRollOffset = clip.postRollOffset;
        return seg;
      })
      .filter((x): x is ExportSegment => x !== null);
  }

  /**
   * Sharing ships clips to the cloud, which the sample game can't do — its
   * video is a remote stream, not a local file, so Clip & Ship's preflight
   * would throw a raw path error. Mirror the export gate's friendly copy.
   */
  function demoShipBlockReason(pl: Playlist): string | null {
    const hasDemoClip = pl.items
      .filter(isClipItem)
      .some((c) => matchLookup.get(c.matchId)?.isDemo);
    return hasDemoClip
      ? "The sample game can't be shared — import your own game to share clips with your team."
      : null;
  }

  /**
   * Patch freshly-uploaded r2Urls into local playlist state so the coach
   * dashboard's counts stay honest and re-runs skip finished clips — even
   * when the run was aborted or the coach cancels the share afterwards.
   */
  function applyR2Urls(uploaded: ClipShipResult["uploaded"], plId: string) {
    if (uploaded.length === 0) return;
    // A clip trimmed while it uploaded: that upload is the old cut. It is
    // not kept (cleared only while it is still the stored URL, so a newer
    // upload is never wiped), and the playlist ships again with the new one.
    const current = selectedRef.current?.id === plId ? selectedRef.current : playlistsRef.current.find((p) => p.id === plId);
    const isStale = (u: ClipShipResult["uploaded"][number]) => {
      if (!current || u.preRollOffset === undefined || u.postRollOffset === undefined) return false;
      const item = current.items.find(
        (i): i is PlaylistClipItem => isClipItem(i) && i.matchId === u.matchId && i.eventId === u.eventId,
      );
      return !!item && ((item.preRollOffset ?? 0) !== u.preRollOffset || (item.postRollOffset ?? 0) !== u.postRollOffset);
    };
    const stale = uploaded.filter(isStale);
    if (stale.length > 0 && current) {
      void Promise.all(stale.map((u) => clearShippedClip(plId, u.matchId, u.eventId, u.r2Url)))
        .then(() => queuePendingShip(current))
        .catch((err) => Sentry.captureException(err));
      uploaded = uploaded.filter((u) => !stale.includes(u));
      if (uploaded.length === 0) return;
    }
    const byKey = new Map(uploaded.map((u) => [`${u.matchId}:${u.eventId}`, u.r2Url]));
    const patch = (pl: Playlist): Playlist => ({
      ...pl,
      items: pl.items.map((item) =>
        item.type === "clip" && byKey.has(`${item.matchId}:${item.eventId}`)
          ? { ...item, r2Url: byKey.get(`${item.matchId}:${item.eventId}`)! }
          : item
      ),
    });
    setSelected((prev) => (prev && prev.id === plId ? patch(prev) : prev));
    setPlaylists((prev) => prev.map((p) => (p.id === plId ? patch(p) : p)));
  }

  /** Write the share rows (this is what triggers recipient notifications). */
  async function commitShare(teamIds: string[], userIds: string[], newlyAddedTeams: string[], newlyAddedUsers: string[]) {
    if (!selected) return;
    await Promise.all([
      setPlaylistTeams(selected.id, teamIds),
      setPlaylistUsers(selected.id, userIds),
    ]);
    setPlaylists((prev) => prev.map((p) =>
      p.id === selected.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p
    ));
    setSelected((prev) => (prev ? { ...prev, teamIds, teamId: teamIds[0], userIds } : prev));
    if (newlyAddedTeams.length + newlyAddedUsers.length > 0) {
      trackEvent("playlist_shared", { team_count: newlyAddedTeams.length, user_count: newlyAddedUsers.length });
    }
  }

  function shareRecipientNames(newlyAddedTeams: string[], newlyAddedUsers: string[]): string {
    const teamNames = newlyAddedTeams.map((id) => userTeams.find((t) => t.id === id)?.name ?? "team");
    const userNames = newlyAddedUsers.map((id) => shareableMembers.find((m) => m.id === id)?.fullName ?? "member");
    return [...teamNames, ...userNames].join(", ");
  }

  // Ship BEFORE share: recipients are notified by the share-row insert, so
  // the rows are only written once their clips are actually watchable.
  // Failures pause in the dialog with explicit choices; Cancel/abort writes
  // nothing and sends nothing.
  async function handleShare(teamIds: string[], userIds: string[]) {
    if (!selected) return;
    const prevTeamIds = selected.teamIds ?? [];
    const prevUserIds = selected.userIds ?? [];
    const newlyAddedTeams = teamIds.filter((id) => !prevTeamIds.includes(id));
    const newlyAddedUsers = userIds.filter((id) => !prevUserIds.includes(id));

    // Removal-only (or no-op) changes need no uploads — commit and close.
    if (newlyAddedTeams.length + newlyAddedUsers.length === 0) {
      setShareDialogOpen(false);
      try {
        await commitShare(teamIds, userIds, [], []);
      } catch (e) {
        toast.error("Couldn't update sharing", { description: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    const demoBlock = demoShipBlockReason(selected);
    if (demoBlock) {
      setShareDialogOpen(false);
      setSharePhase({ kind: "pick" });
      toast.error("Couldn't share playlist", { description: demoBlock });
      return;
    }

    const segments = buildShipSegments(selected);
    setSharePhase({ kind: "uploading" });
    setIsShipping(true);
    setShipProgress(null);
    const controller = new AbortController();
    shareAbortRef.current = controller;
    let result: ClipShipResult;
    try {
      result = await clipAndShip(selected, segments, preRoll, postRoll, {
        onProgress: (done, total) => setShipProgress({ done, total }),
        signal: controller.signal,
      });
    } catch (e) {
      // Preflight throw (non-local video) — nothing was uploaded or shared.
      toast.error("Couldn't upload clips", { description: e instanceof Error ? e.message : String(e) });
      setSharePhase({ kind: "pick" });
      return;
    } finally {
      setIsShipping(false);
      setShipProgress(null);
      shareAbortRef.current = null;
    }

    applyR2Urls(result.uploaded, selected.id);

    if (result.aborted) {
      setSharePhase({ kind: "pick" });
      return;
    }

    if (result.failures.length > 0) {
      trackEvent("playlist_ship_failed", {
        playlist_id: selected.id,
        failed: result.failures.length,
        total: segments.length,
      });
      const failedKeys = new Set(result.failures.map((f) => `${f.matchId}:${f.eventId}`));
      setSharePhase({
        kind: "resolve",
        result,
        total: segments.length,
        teamIds,
        userIds,
        failedSegments: segments.filter(
          (s) => s.kind === "clip" && failedKeys.has(`${s.matchId}:${s.event.eventId}`)
        ),
        });
      return;
    }

    try {
      await commitShare(teamIds, userIds, newlyAddedTeams, newlyAddedUsers);
    } catch (e) {
      toast.error("Couldn't share playlist", { description: e instanceof Error ? e.message : String(e) });
      setSharePhase({ kind: "pick" });
      return;
    }
    setShareDialogOpen(false);
    setSharePhase({ kind: "pick" });
    const clipCount = result.shipped + result.skipped;
    toast.success("Clips shared", {
      description: `${clipCount} clip${clipCount === 1 ? "" : "s"} shared with ${shareRecipientNames(newlyAddedTeams, newlyAddedUsers)}.`,
    });
    trackEvent("playlist_shipped", { playlist_id: selected.id, clip_count: clipCount });
  }

  /** "Try again" in the resolve step: re-ship only the failed clips. */
  async function handleShareRetry(phase: Extract<SharePhase, { kind: "resolve" }>) {
    if (!selected) return;
    setSharePhase({ kind: "uploading" });
    setIsShipping(true);
    setShipProgress(null);
    const controller = new AbortController();
    shareAbortRef.current = controller;
    let retry: ClipShipResult;
    try {
      retry = await clipAndShip(selected, phase.failedSegments, preRoll, postRoll, {
        onProgress: (done, total) => setShipProgress({ done, total }),
        signal: controller.signal,
      });
    } catch (e) {
      toast.error("Couldn't upload clips", { description: e instanceof Error ? e.message : String(e) });
      setSharePhase(phase);
      return;
    } finally {
      setIsShipping(false);
      setShipProgress(null);
      shareAbortRef.current = null;
    }

    applyR2Urls(retry.uploaded, selected.id);
    const merged = mergeShipResults(phase.result, retry);

    if (retry.aborted || merged.failures.length > 0) {
      const failedKeys = new Set(merged.failures.map((f) => `${f.matchId}:${f.eventId}`));
      setSharePhase({
        ...phase,
        result: merged,
        failedSegments: phase.failedSegments.filter(
          (s) => s.kind === "clip" && failedKeys.has(`${s.matchId}:${s.event.eventId}`)
        ),
      });
      return;
    }
    // Everything shipped on retry — proceed exactly like the happy path.
    await finishResolvedShare(phase.teamIds, phase.userIds, merged, phase.total);
  }

  /** Commit + close from the resolve step ("Share without them" or clean retry). */
  async function finishResolvedShare(teamIds: string[], userIds: string[], result: ClipShipResult, total: number) {
    if (!selected) return;
    const prevTeamIds = selected.teamIds ?? [];
    const prevUserIds = selected.userIds ?? [];
    const newlyAddedTeams = teamIds.filter((id) => !prevTeamIds.includes(id));
    const newlyAddedUsers = userIds.filter((id) => !prevUserIds.includes(id));
    try {
      await commitShare(teamIds, userIds, newlyAddedTeams, newlyAddedUsers);
    } catch (e) {
      toast.error("Couldn't share playlist", { description: e instanceof Error ? e.message : String(e) });
      return;
    }
    setShareDialogOpen(false);
    setSharePhase({ kind: "pick" });
    const uploadedCount = result.shipped + result.skipped;
    if (result.failures.length === 0) {
      toast.success("Clips shared", {
        description: `${uploadedCount} clip${uploadedCount === 1 ? "" : "s"} shared with ${shareRecipientNames(newlyAddedTeams, newlyAddedUsers)}.`,
      });
    } else {
      toast.success("Playlist shared", {
        description: `${uploadedCount} of ${total} clips uploaded — recipients can watch them now.`,
      });
    }
    trackEvent("playlist_shipped", { playlist_id: selected.id, clip_count: uploadedCount });
  }

  // Deferred/reship path (dashboard "Upload missing clips", clips added to an
  // already-shared playlist). Headless — progress lives in the toolbar
  // indicator; failures toast with counts and SharedByMe owns the recovery
  // affordance. After any successful upload, pending silent shares (created
  // before the playlist had clips) finally notify their recipients.
  async function handleShip(target: Playlist) {
    const demoBlock = demoShipBlockReason(target);
    if (demoBlock) {
      toast.error("Couldn't upload clips", { description: demoBlock });
      return;
    }
    setIsShipping(true);
    setShipProgress(null);
    try {
      const segments = buildShipSegments(target);
      const result = await clipAndShip(target, segments, preRoll, postRoll, {
        onProgress: (done, total) => setShipProgress({ done, total }),
      });
      applyR2Urls(result.uploaded, target.id);

      const total = segments.length;
      const uploadedCount = result.shipped + result.skipped;
      if (result.failures.length > 0) {
        trackEvent("playlist_ship_failed", { playlist_id: target.id, failed: result.failures.length, total });
        toast.error(
          `${result.failures.length} of ${total} clips in "${target.name}" didn't upload`,
          { description: "Recipients can't see these clips yet — try again from Shared by me." },
        );
      } else if (result.shipped > 0) {
        // Silent when everything was already in the cloud (idempotent re-run).
        toast.success(`Clips uploaded to "${target.name}"`, {
          description: `${uploadedCount} clip${uploadedCount === 1 ? " is" : "s are"} now in the cloud.`,
        });
        trackEvent("playlist_shipped", { playlist_id: target.id, clip_count: uploadedCount });
      }

      if (uploadedCount > 0) {
        // Best-effort and idempotent — a no-op unless silent pending shares exist.
        await notifyPendingPlaylistShares(target.id).catch(() => {});
      }
    } catch (e) {
      toast.error("Clip & Ship failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setIsShipping(false);
      setShipProgress(null);
    }
  }

  // handleShare is defined above (replaces handleShareToTeam / handleShareWithTeams)

  // Runs a pending ship once the recorded playlist and matches are actually
  // in state — both the dashboard arrival and the post-add hook set the ref
  // before the data they need has settled, so calling handleShip directly
  // would ship a stale item list. Ships the RECORDED playlist (looked up
  // fresh from state), not whatever is selected — the coach may have
  // switched focus by the time this fires. clipAndShip is idempotent: only
  // missing clips upload.
  const handleShipRef = useRef(handleShip);
  handleShipRef.current = handleShip;
  useEffect(() => {
    if (pendingShipRef.current.size === 0 || loading || isShipping) return;
    if (matches.length === 0) return;
    // Drain one pending ship; isShipping flipping back to false re-runs this
    // effect, so multiple pending playlists ship sequentially.
    const targetId = [...pendingShipRef.current].find(
      (id) => selected?.id === id || playlists.some((p) => p.id === id)
    );
    if (!targetId) return;
    const target = selected?.id === targetId ? selected : playlists.find((p) => p.id === targetId)!;
    pendingShipRef.current.delete(targetId);
    void handleShipRef.current(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipNonce, selected, playlists, matches, loading, isShipping]);

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
    // The save of a new playlist opens it once it has a real id (a slow save
    // left one open and filled under its temp id, SCOUTABLE-DESKTOP-M).
    if (isUnsavedId(pl.id)) return;
    setSelected(pl);
    setShowClipBrowser(false);
  }

  // ---------------------------------------------------------------------------
  // Folder operations
  // ---------------------------------------------------------------------------

  function handleNewFolder(parentId?: string) {
    const tempId = `temp-${Date.now()}`;
    setPendingNewFolderId(tempId);
    setFolders((prev) => [...prev, { id: tempId, name: "New Folder", sortOrder: 0, parentId }]);
    setExpandedFolders((prev) => {
      const s = new Set([...prev, tempId]);
      if (parentId) s.add(parentId); // temp row must be visible inside its parent
      return s;
    });
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
      const parentId = folders.find((f) => f.id === id)?.parentId;
      try {
        const folder = await createFolder(name, parentId, activeOrgId ?? undefined);
        trackEvent("folder_created", { nested: parentId != null });
        setFolders((prev) => prev.map((f) => f.id === id ? folder : f));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); s.add(folder.id); return s; });
      } catch (err) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        setExpandedFolders((prev) => { const s = new Set(prev); s.delete(id); return s; });
        console.error("Failed to create folder:", err);
        toast.error("Couldn't create the folder", { description: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (!name) { setEditingFolderId(null); return; }
    await updateFolder(id, { name });
    setFolders((prev) => prev.map((f) => f.id === id ? { ...f, name } : f));
    setEditingFolderId(null);
  }

  /** Opens the confirm dialog for non-empty folders; empty ones delete straight away. */
  function requestDeleteFolder(folder: PlaylistFolder) {
    const stats = subtreeStats(folders, playlists, folder.id);
    if (stats.folderCount === 0 && stats.playlistCount === 0) {
      void handleDeleteFolder(folder.id);
    } else {
      setDeleteFolderTarget(folder);
    }
  }

  async function handleDeleteFolder(folderId: string) {
    // Subtree delete: DB CASCADE removes descendant folders, and
    // playlists.folder_id ON DELETE SET NULL moves every contained playlist to
    // Uncategorized. Mirror all of it optimistically.
    const ids = collectSubtreeIds(folders, folderId);
    setPlaylists((prev) => prev.map((p) =>
      p.folderId && ids.has(p.folderId) ? { ...p, folderId: undefined } : p
    ));
    setSelected((prev) =>
      prev && prev.folderId && ids.has(prev.folderId) ? { ...prev, folderId: undefined } : prev
    );
    setFolders((prev) => prev.filter((f) => !ids.has(f.id)));
    setExpandedFolders((prev) => {
      const s = new Set(prev);
      ids.forEach((id) => s.delete(id));
      return s;
    });
    try {
      await deleteFolder(folderId);
    } catch (err) {
      console.error("Failed to delete folder:", err);
      toast.error("Couldn't delete the folder — reloading");
      const [freshFolders, freshPlaylists] = await Promise.all([
        listFolders(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }),
        listPlaylists(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }),
      ]);
      setFolders(freshFolders);
      setPlaylists(freshPlaylists);
    }
  }

  function handleDragStart(playlistId: string, e: React.DragEvent) {
    e.dataTransfer.setData("text/playlist-id", playlistId);
  }

  function handleFolderDragStart(folderId: string, e: React.DragEvent) {
    e.dataTransfer.setData("text/folder-id", folderId);
    draggedFolderIdRef.current = folderId;
  }

  async function movePlaylistToFolder(playlistId: string, folderId: string | null) {
    await updatePlaylist(playlistId, { folderId });
    setPlaylists((prev) => prev.map((p) =>
      p.id === playlistId ? { ...p, folderId: folderId ?? undefined } : p
    ));
    if (selected?.id === playlistId) {
      setSelected((prev) => prev ? { ...prev, folderId: folderId ?? undefined } : prev);
    }
  }

  async function moveFolderToParent(folderId: string, newParentId: string | null) {
    const current = folders.find((f) => f.id === folderId);
    if (!current || (current.parentId ?? null) === newParentId) return;
    if (wouldCreateCycle(folders, folderId, newParentId)) {
      toast.error("Can't move a folder into itself");
      return;
    }
    setFolders((prev) => prev.map((f) =>
      f.id === folderId ? { ...f, parentId: newParentId ?? undefined } : f
    ));
    try {
      await updateFolder(folderId, { parentId: newParentId });
    } catch (err) {
      console.error("Failed to move folder:", err);
      toast.error("Couldn't move the folder — reloading");
      setFolders(await listFolders(activeOrgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }));
    }
  }

  async function handleDrop(targetFolderId: string | null, e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolder(null);
    const folderId = e.dataTransfer.getData("text/folder-id");
    if (folderId) {
      await moveFolderToParent(folderId, targetFolderId);
      return;
    }
    const playlistId = e.dataTransfer.getData("text/playlist-id");
    if (!playlistId) return;
    await movePlaylistToFolder(playlistId, targetFolderId);
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
        const created = await createPlaylist(name, folderId, activeOrgId ?? undefined);
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

  async function confirmDeletePlaylist() {
    const target = deleteTarget;
    if (!target) return;
    setDeletingPlaylist(true);
    try {
      await deletePlaylist(target.id);
      setPlaylists((prev) => prev.filter((p) => p.id !== target.id));
      if (selected?.id === target.id) setSelected(null);
    } finally {
      setDeletingPlaylist(false);
      setDeleteTarget(null);
    }
  }

  // ---------------------------------------------------------------------------
  // New Playlist inline creation
  // ---------------------------------------------------------------------------

  /**
   * undefined → inherit the selected playlist's folder (header button
   * behavior); a folder id → create inside it (context menu); null → root.
   */
  function handleNewPlaylist(folderIdOverride?: string | null) {
    setBrowserCollapsed(false);
    const tempId = `temp-${Date.now()}`;
    const folderId = folderIdOverride === undefined ? selected?.folderId : folderIdOverride ?? undefined;
    const tempPlaylist: Playlist = { id: tempId, name: "New Playlist", items: [], folderId };
    setPendingNewPlaylistId(tempId);
    setPlaylists((prev) => [tempPlaylist, ...prev]);
    if (folderId) {
      setExpandedFolders((prev) => new Set([...prev, folderId]));
    } else {
      setUncategorizedExpanded(true);
    }
    setEditingVia("sidebar");
    setEditingPlaylistId(tempId);
    setEditPlaylistName("New Playlist");
  }

  // ---------------------------------------------------------------------------
  // Sidebar tree rendering. Plain functions, NOT nested components — a nested
  // component would remount (and lose focus in) the inline rename <input> on
  // every keystroke.
  // ---------------------------------------------------------------------------

  /** One step of indent per folder depth. */
  const FOLDER_INDENT = 14;

  function renderSectionHeader({
    id,
    label,
    count,
    expanded,
    onToggle,
    dragOver,
    springLoading,
  }: {
    id: string;
    label: string;
    count: number;
    expanded: boolean;
    onToggle: () => void;
    dragOver?: boolean;
    springLoading?: boolean;
  }): React.ReactNode {
    return (
      <div
        data-folder-id={id === "uncategorized" ? "uncategorized" : undefined}
        className={cn(
          "mx-2 mt-2 flex h-6 cursor-default select-none items-center gap-1 rounded-md px-1.5 text-subheadline font-semibold text-muted-foreground transition-colors duration-100 hover:text-foreground",
          dragOver && "bg-primary/10 ring-1 ring-inset ring-selection",
          springLoading && "text-primary",
        )}
        onClick={onToggle}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="nums">{count}</span>
        <ChevronRight className={cn("size-3 shrink-0 transition-transform duration-150 ease-spring", expanded && "rotate-90")} />
      </div>
    );
  }

  function renderPlaylistRow(pl: Playlist, depth: number): React.ReactNode {
    const isActive = selected?.id === pl.id;
    const isEditingThis = editingPlaylistId === pl.id;
    const isDropTarget = clipDragOverPlaylistId === pl.id;
    const menuOpen = openMenuPlaylistId === pl.id;
    // Named, but its save hasn't returned: the row waits, out of reach of
    // clicks, menus and drops, which would all target its temp id.
    const isSaving = isUnsavedId(pl.id) && !isEditingThis;
    return (
      <ContextMenu key={pl.id}>
        <ContextMenuTrigger asChild>
          <div
            data-playlist-id={isUnsavedId(pl.id) ? undefined : pl.id}
            draggable={!isEditingThis}
            onDragStart={(e) => handleDragStart(pl.id, e)}
            onDragEnd={() => setDragOverFolder(null)}
            style={{ paddingLeft: 8 + depth * FOLDER_INDENT }}
            className={cn(
              "group mx-2 flex h-7 cursor-default select-none items-center gap-1.5 rounded-md pr-1.5 outline-none transition-[background-color,box-shadow] duration-100",
              isActive ? "bg-selection text-selection-foreground" : "text-foreground hover:bg-fill-1 active:bg-fill-2",
              isDropTarget && "bg-selection/20 ring-2 ring-inset ring-selection",
              clipOpenPlaylistId === pl.id && "animate-pulse",
              isSaving && "pointer-events-none opacity-60",
            )}
            onClick={() => !isEditingThis && selectPlaylist(pl)}
          >
            <ListVideo className={cn("size-4 shrink-0", isActive ? "text-selection-foreground" : "text-primary")} />
            {isEditingThis && editingVia === "sidebar" ? (
              <input
                autoFocus
                className="h-5 min-w-0 flex-1 rounded-sm bg-card px-1 text-sm text-foreground ring-2 ring-selection outline-none"
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
                <span className="min-w-0 flex-1 truncate text-sm">{pl.name}</span>
                {(pl.teamIds?.length ?? 0) > 0 && (
                  <Users className={cn("size-3 shrink-0", isActive ? "text-selection-foreground/80" : "text-muted-foreground")} />
                )}
              </>
            )}
            <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
              <span
                className={cn(
                  "text-xs nums",
                  isActive ? "text-selection-foreground/80" : "text-muted-foreground",
                  menuOpen ? "hidden" : "group-hover:hidden",
                )}
              >
                {pl.items.length}
              </span>
              <DropdownMenu
                open={menuOpen}
                onOpenChange={(open) => setOpenMenuPlaylistId(open ? pl.id : null)}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Playlist actions"
                    className={cn(
                      "size-5 items-center justify-center rounded-sm outline-none transition-colors duration-100",
                      isActive ? "text-selection-foreground hover:bg-white/20" : "text-muted-foreground hover:bg-fill-2 hover:text-foreground",
                      menuOpen ? "flex" : "hidden group-hover:flex",
                    )}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Keep in lockstep with the row's ContextMenuContent below. */}
                  <>
                    <DropdownMenuItem onSelect={() => { setEditingVia("sidebar"); setEditingPlaylistId(pl.id); setEditPlaylistName(pl.name); }}>
                      Rename
                    </DropdownMenuItem>
                    {(folders.length > 0 || pl.folderId) && (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Move to folder</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                          <DropdownMenuItem
                            disabled={!pl.folderId}
                            onSelect={() => movePlaylistToFolder(pl.id, null)}
                          >
                            Uncategorized
                          </DropdownMenuItem>
                          {folders.length > 0 && <DropdownMenuSeparator />}
                          {flatFolders.map(({ folder, depth: folderDepth }) => (
                            <DropdownMenuItem
                              key={folder.id}
                              disabled={pl.folderId === folder.id}
                              style={{ paddingLeft: 8 + folderDepth * 12 }}
                              onSelect={() => {
                                void movePlaylistToFolder(pl.id, folder.id);
                                setExpandedFolders((prev) => new Set([...prev, folder.id]));
                              }}
                            >
                              {folder.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteTarget(pl)}
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
          <ContextMenuItem onSelect={() => { setEditingVia("sidebar"); setEditingPlaylistId(pl.id); setEditPlaylistName(pl.name); }}>
            Rename
          </ContextMenuItem>
          {(folders.length > 0 || pl.folderId) && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>Move to folder</ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                <ContextMenuItem
                  disabled={!pl.folderId}
                  onSelect={() => movePlaylistToFolder(pl.id, null)}
                >
                  Uncategorized
                </ContextMenuItem>
                {folders.length > 0 && <ContextMenuSeparator />}
                {flatFolders.map(({ folder, depth: folderDepth }) => (
                  <ContextMenuItem
                    key={folder.id}
                    disabled={pl.folderId === folder.id}
                    style={{ paddingLeft: 8 + folderDepth * 12 }}
                    onSelect={() => {
                      void movePlaylistToFolder(pl.id, folder.id);
                      setExpandedFolders((prev) => new Set([...prev, folder.id]));
                    }}
                  >
                    {folder.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteTarget(pl)}
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
  }

  function renderFolderNode(folder: PlaylistFolder, depth: number): React.ReactNode {
    const items = byFolder.get(folder.id) ?? [];
    const subfolders = childFolders.get(folder.id) ?? [];
    if (visibleFolderIdsWhileSearching && !visibleFolderIdsWhileSearching.has(folder.id)) return null;
    const isExpanded = search.trim() ? true : expandedFolders.has(folder.id);
    const isEditing = editingFolderId === folder.id;
    const isDragOver = dragOverFolder === folder.id;
    const springLoading = clipExpandFolderId === folder.id;
    const menuOpen = openMenuFolderId === folder.id;
    return (
      <div
        key={folder.id}
        // Folder and playlist moves stay on the browser's native drag; clip
        // drags are the pointer engine's and never reach these handlers.
        onDragEnter={(e) => {
          e.preventDefault();
          // Nested wrappers: only the innermost folder may claim the drag.
          e.stopPropagation();
          if (
            e.dataTransfer.types.includes("text/folder-id") &&
            draggedFolderIdRef.current &&
            wouldCreateCycleWith(folderDescendants, draggedFolderIdRef.current, folder.id)
          ) return;
          setDragOverFolder(folder.id);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (
            e.dataTransfer.types.includes("text/folder-id") &&
            draggedFolderIdRef.current &&
            wouldCreateCycleWith(folderDescendants, draggedFolderIdRef.current, folder.id)
          ) {
            // Dropping a folder into itself/its own subtree: refuse visibly.
            e.dataTransfer.dropEffect = "none";
            setDragOverFolder(null);
            return;
          }
          e.dataTransfer.dropEffect = "move";
          setDragOverFolder(folder.id);
          // Spring-load collapsed folders for playlist and folder drags too.
          if (!isExpanded && clipDragFolderExpandTimerRef.current === null) {
            setClipExpandFolderId(folder.id);
            clipDragFolderExpandTimerRef.current = setTimeout(() => {
              clipDragFolderExpandTimerRef.current = null;
              setClipExpandFolderId(null);
              setExpandedFolders((prev) => new Set([...prev, folder.id]));
            }, 600);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverFolder(null);
            if (clipDragFolderExpandTimerRef.current) {
              clearTimeout(clipDragFolderExpandTimerRef.current);
              clipDragFolderExpandTimerRef.current = null;
              setClipExpandFolderId(null);
            }
          }
        }}
        onDrop={(e) => handleDrop(folder.id, e)}
      >
        {/* Folder header */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              data-folder-id={folder.id}
              draggable={!isEditing}
              onDragStart={(e) => {
                // Don't also start an ancestor folder's drag.
                e.stopPropagation();
                handleFolderDragStart(folder.id, e);
              }}
              onDragEnd={() => {
                draggedFolderIdRef.current = null;
                setDragOverFolder(null);
              }}
              style={{ paddingLeft: 8 + depth * FOLDER_INDENT }}
              className={cn(
                "group mx-2 flex h-7 cursor-default select-none items-center gap-1 rounded-md pr-1.5 text-foreground outline-none transition-[background-color,box-shadow] duration-100",
                !isDragOver && "hover:bg-fill-1 active:bg-fill-2",
                isDragOver && "bg-primary/10 ring-2 ring-inset ring-selection",
                springLoading && "bg-primary/10",
              )}
              onClick={() => !isEditing && toggleFolder(folder.id)}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 transition-transform duration-150 ease-spring",
                  isExpanded && "rotate-90",
                  springLoading ? "text-primary" : "text-muted-foreground",
                )}
              />
              <Folder className="size-4 shrink-0 text-primary" />
              {isEditing ? (
                <input
                  autoFocus
                  className="h-5 min-w-0 flex-1 rounded-sm bg-card px-1 text-sm text-foreground ring-2 ring-selection outline-none"
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
                  className="min-w-0 flex-1 truncate text-sm font-medium"
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
                  <span className={cn("text-xs nums text-muted-foreground", menuOpen ? "hidden" : "group-hover:hidden")}>
                    {items.length}
                  </span>
                  <DropdownMenu
                    open={menuOpen}
                    onOpenChange={(open) => setOpenMenuFolderId(open ? folder.id : null)}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="Folder actions"
                        className={cn(
                          "size-5 items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-2 hover:text-foreground",
                          menuOpen ? "flex" : "hidden group-hover:flex",
                        )}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {/* Keep in lockstep with the folder header's ContextMenuContent below. */}
                      <DropdownMenuItem onSelect={() => handleNewPlaylist(folder.id)}>
                        New Playlist
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleNewFolder(folder.id)}>
                        New Subfolder
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                          <DropdownMenuItem
                            disabled={!folder.parentId}
                            onSelect={() => void moveFolderToParent(folder.id, null)}
                          >
                            Top level
                          </DropdownMenuItem>
                          {folders.length > 1 && <DropdownMenuSeparator />}
                          {flatFolders.map(({ folder: target, depth: targetDepth }) => (
                            <DropdownMenuItem
                              key={target.id}
                              disabled={
                                wouldCreateCycleWith(folderDescendants, folder.id, target.id) ||
                                (folder.parentId ?? null) === target.id
                              }
                              style={{ paddingLeft: 8 + targetDepth * 12 }}
                              onSelect={() => {
                                void moveFolderToParent(folder.id, target.id);
                                setExpandedFolders((prev) => new Set([...prev, target.id]));
                              }}
                            >
                              {target.name}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuItem onSelect={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }}>
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => requestDeleteFolder(folder)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <span className="shrink-0 text-xs nums text-muted-foreground">{items.length}</span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => handleNewPlaylist(folder.id)}>
              New Playlist
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => handleNewFolder(folder.id)}>
              New Subfolder
            </ContextMenuItem>
            <ContextMenuSeparator />
            {/* Menu path back to root (and anywhere else) — drag needs a drop
                target, which a full sidebar doesn't always offer. */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
              <ContextMenuSubContent className="max-h-72 overflow-y-auto">
                <ContextMenuItem
                  disabled={!folder.parentId}
                  onSelect={() => void moveFolderToParent(folder.id, null)}
                >
                  Top level
                </ContextMenuItem>
                {folders.length > 1 && <ContextMenuSeparator />}
                {flatFolders.map(({ folder: target, depth: targetDepth }) => (
                  <ContextMenuItem
                    key={target.id}
                    disabled={
                      wouldCreateCycleWith(folderDescendants, folder.id, target.id) ||
                      (folder.parentId ?? null) === target.id
                    }
                    style={{ paddingLeft: 8 + targetDepth * 12 }}
                    onSelect={() => {
                      void moveFolderToParent(folder.id, target.id);
                      setExpandedFolders((prev) => new Set([...prev, target.id]));
                    }}
                  >
                    {target.name}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem onSelect={() => { setEditingFolderId(folder.id); setEditFolderName(folder.name); }}>
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => requestDeleteFolder(folder)}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Subfolders, then this folder's playlists */}
        {isExpanded && (
          <div>
            {subfolders.map((sub) => renderFolderNode(sub, depth + 1))}
            {items.length === 0 && subfolders.length === 0 ? (
              <p
                style={{ paddingLeft: 8 + (depth + 1) * FOLDER_INDENT + 22 }}
                className="mx-2 flex h-7 items-center text-subheadline text-muted-foreground/70"
              >
                Empty — drag a playlist here
              </p>
            ) : (
              items.map((pl) => renderPlaylistRow(pl, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Add clips from clip browser
  // ---------------------------------------------------------------------------

  async function handleAddClips(newClips: PlaylistClipItem[]) {
    if (!selected || isUnsavedId(selected.id) || newClips.length === 0) return;
    const pl = selected;
    const noun = newClips.length === 1 ? "1 clip" : `${newClips.length} clips`;
    // The Add clips sheet stays open, where ⌘Z isn't the playlist's: the toast carries the Undo.
    const ok = await commitItemsEdit(pl, [...pl.items, ...newClips], newClips.length === 1 ? "Add clip" : `Add ${newClips.length} clips`, `${noun} added`);
    // A failed add is taken back and says so (over the clip browser, which stays open for the next round).
    if (!ok) return;
    newClips.forEach((clip) => {
      trackEvent('clip_added_to_playlist', { playlist_id: pl.id, match_id: clip.matchId })
    })
    // Clips added to an already-shared playlist must ship immediately —
    // recipients can't see unshipped clips at all, and nothing else would
    // ever upload them (sharing only ships toward NEW recipients). Armed
    // after the rows exist so updateClipR2Url has something to patch.
    queuePendingShip(pl);
  }

  // ---------------------------------------------------------------------------
  // Clip selection helpers
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Changes to the rows: one path, ⌘Z / ⇧⌘Z, and ⌘X / ⌘C / ⌘V
  // ---------------------------------------------------------------------------

  /**
   * Brings the server from `from` to `to` (rows deleted, rows put back with
   * their settings and hosted files, then the order and groups), after the
   * playlist's earlier writes. A failure takes the change back on screen when
   * nothing changed since, and forgets the playlist's history: it no longer
   * matches what is saved.
   */
  function writeItems(playlistId: string, from: PlaylistItem[], to: PlaylistItem[]): Promise<boolean> {
    const prev = writeChainRef.current.get(playlistId) ?? Promise.resolve(true);
    const run = prev.then(async () => {
      try {
        const d = itemsDiff(from, to);
        if (d.removedClips.length > 0 || d.removedTextIds.length > 0) await removeClips(playlistId, d.removedClips, d.removedTextIds);
        if (d.addedClips.length > 0) await addClips(playlistId, d.addedClips, 0, { restore: true });
        for (const t of d.addedText) await insertTextCard(playlistId, t.id, t.text, t.durationSeconds, 0, t.card);
        await reorderItems(playlistId, to);
        return true;
      } catch (err) {
        console.error("[playlists] Failed to save a change to the list:", err);
        Sentry.captureException(err);
        historyRef.current.delete(playlistId);
        const now = selectedRef.current;
        if (now?.id === playlistId && now.items === to) {
          const restored = { ...now, items: from };
          selectedRef.current = restored;
          setSelected(restored);
        }
        setPlaylists((ps) => ps.map((p) => (p.id === playlistId && p.items === to ? { ...p, items: from } : p)));
        toast.error("Couldn’t save that change, so it was taken back. Check the connection and try again.", { id: EDIT_TOAST });
        return false;
      }
    });
    writeChainRef.current.set(playlistId, run);
    return run;
  }

  /**
   * One change to the open playlist's rows (remove, move, group, add, paste,
   * cut): shown at once, recorded for ⌘Z, saved after the playlist's earlier
   * writes. `notice` is a toast with Undo. Resolves false when the save failed
   * (the change was taken back).
   */
  function commitItemsEdit(pl: Playlist, after: PlaylistItem[], label: string, notice?: string): Promise<boolean> {
    const before = pl.items;
    const updated = { ...pl, items: after };
    selectedRef.current = updated;
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? updated : p)));
    if (isUnsavedId(pl.id)) return Promise.resolve(true);
    const edit: ItemsEdit = { label, before, after };
    historyRef.current.set(pl.id, recordEdit(historyRef.current.get(pl.id) ?? emptyHistory(), edit));
    if (notice) toast(notice, { id: EDIT_TOAST, action: { label: "Undo", onClick: () => undoIfLatest(pl.id, edit) } });
    return writeItems(pl.id, before, after);
  }

  /** The toast's Undo: the same as ⌘Z, while the edit it names is still the last one. */
  function undoIfLatest(playlistId: string, edit: ItemsEdit) {
    const past = historyRef.current.get(playlistId)?.past ?? [];
    if (selectedRef.current?.id === playlistId && past[past.length - 1] === edit) stepHistory("undo");
  }

  /**
   * ⌘Z / ⇧⌘Z: the open playlist's rows go back to (or forward to) an edit's
   * snapshot, each row as it is now (a later note stays). What comes back is
   * selected, as in Finder. False when there is nothing to step to.
   */
  function stepHistory(direction: "undo" | "redo"): boolean {
    const pl = selectedRef.current;
    if (!pl || isUnsavedId(pl.id)) return false;
    const step = (direction === "undo" ? takeUndo : takeRedo)(historyRef.current.get(pl.id) ?? emptyHistory());
    if (!step) return false;
    historyRef.current.set(pl.id, step.history);
    const from = pl.items;
    const to = materialize(direction === "undo" ? step.edit.before : step.edit.after, from);
    const updated = { ...pl, items: to };
    selectedRef.current = updated;
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? updated : p)));
    const had = new Set(from.map(playlistItemKey));
    const back = to.map(playlistItemKey).filter((k) => !had.has(k));
    if (back.length > 0) {
      setSelectedClipIds(new Set(back));
      setFocusKey(back[0]);
      setAnchorKey(back[0]);
    }
    toast(`${direction === "undo" ? "Undo" : "Redo"}: ${step.edit.label}`, { id: EDIT_TOAST, duration: 2000 });
    void writeItems(pl.id, from, to).then((ok) => {
      if (ok && itemsDiff(from, to).addedClips.length > 0) queuePendingShip(updated);
    });
    return true;
  }

  function handleRemoveSelected() {
    if (!selected || selectedClipIds.size === 0) return;
    const newItems = normalizeGroups(selected.items.filter((c) => !selectedClipIds.has(playlistItemKey(c))));
    const count = selected.items.length - newItems.length;
    const after = focusAfterRemoval(visibleKeys, selectedClipIds, focusKey);
    setFocusKey(after);
    setAnchorKey(after);
    setSelectedClipIds(new Set());
    const noun = `${count} item${count !== 1 ? "s" : ""}`;
    void commitItemsEdit(selected, newItems, `Remove ${noun}`, `${noun} removed`);
  }

  function handleRemoveSingleClip(item: PlaylistClipItem) {
    if (!selected) return;
    void commitItemsEdit(selected, normalizeGroups(selected.items.filter((i) => i !== item)), "Remove clip", "Clip removed");
  }

  function handleRemoveSingleTextCard(card: PlaylistTextCard) {
    if (!selected) return;
    void commitItemsEdit(selected, normalizeGroups(selected.items.filter((i) => i !== card)), "Remove text card", "Text card removed");
  }

  /** A row as text for the system clipboard: "Q2 04:31 · 3PT Made · Alva Berg", or a card's text. */
  function rowText(item: PlaylistItem): string {
    if (!isClipItem(item)) return item.text;
    const e = eventByKey.get(`${item.matchId}:${item.eventId}`);
    return e ? [`${periodLabel(e.period)} ${formatGameClock(e.gameClockTime)}`, eventLabel(e), playerName(e)].filter(Boolean).join(" · ") : "";
  }

  /** ⌘C / ⌘X: the selected rows, else the focused one. False when there is nothing to take. */
  function copyRows(cut: boolean): boolean {
    const pl = selectedRef.current;
    if (!pl) return false;
    const keys = selectedClipIds.size > 0 ? selectedClipIds : focusKey !== null ? new Set([focusKey]) : null;
    const rows = keys ? pl.items.filter((i) => keys.has(playlistItemKey(i))) : [];
    if (rows.length === 0) return false;
    rowClipboard = rows;
    void navigator.clipboard?.writeText(rows.map(rowText).filter(Boolean).join("\n")).catch(() => {});
    const noun = `${rows.length} item${rows.length !== 1 ? "s" : ""}`;
    if (!cut) {
      toast(`${noun} copied. Paste with ${MOD}V here or in another playlist.`, { id: EDIT_TOAST, duration: 2500 });
      return true;
    }
    const taken = new Set(rows.map(playlistItemKey));
    const next = focusAfterRemoval(visibleKeys, taken, focusKey);
    setFocusKey(next);
    setAnchorKey(next);
    setSelectedClipIds(new Set());
    void commitItemsEdit(pl, normalizeGroups(pl.items.filter((i) => !taken.has(playlistItemKey(i)))), `Cut ${noun}`, `${noun} cut. Paste with ${MOD}V.`);
    return true;
  }

  /** ⌘V: what ⌘C or ⌘X took, after the focused row (past its group), else at the end; then selected. */
  function pasteRows(): boolean {
    const pl = selectedRef.current;
    if (!pl || rowClipboard.length === 0) return false;
    const { items, pasted } = pasteItems(pl.items, rowClipboard, pasteIndexAfter(pl.items, focusKey));
    if (pasted.length === 0) {
      toast("Those clips are already in this playlist", { id: EDIT_TOAST });
      return true;
    }
    const keys = pasted.map(playlistItemKey);
    setSelectedClipIds(new Set(keys));
    setFocusKey(keys[0]);
    setAnchorKey(keys[0]);
    const noun = `${pasted.length} item${pasted.length !== 1 ? "s" : ""}`;
    pasted.filter(isClipItem).forEach((c) => trackEvent("clip_added_to_playlist", { playlist_id: pl.id, match_id: c.matchId }));
    void commitItemsEdit(pl, items, `Paste ${noun}`, `${noun} pasted`).then((ok) => {
      if (ok && pasted.some(isClipItem)) queuePendingShip({ ...pl, items });
    });
    return true;
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
      .map((item) => {
        const found = clipByKey.get(`${item.matchId}:${item.event.eventId}`)
          ?? { type: 'clip' as const, matchId: item.matchId, eventId: item.event.eventId };
        // Copies never carry group membership into the target playlist.
        const { groupId: _g, ...clean } = found;
        return clean as PlaylistClipItem;
      });
    await addClips(target.id, toAdd, target.items.length);
    toAdd.forEach((clip) => {
      trackEvent('clip_added_to_playlist', { playlist_id: target.id, match_id: clip.matchId })
    })
    // Append onto whatever the row holds now rather than a pre-await snapshot,
    // and skip clips a concurrent add already landed — mirrors the insert's
    // own on-conflict-do-nothing so optimistic state can't drift from the DB.
    setPlaylists((prev) => prev.map((p) => {
      if (p.id !== target.id) return p;
      const present = new Set(p.items.filter(isClipItem).map((c) => `${c.matchId}:${c.eventId}`));
      const fresh = toAdd.filter((c) => !present.has(`${c.matchId}:${c.eventId}`));
      return fresh.length > 0 ? { ...p, items: [...p.items, ...fresh] } : p;
    }));
    // Clips added into an already-shared playlist must ship like any other
    // add — the sibling add paths all do this and this one was missed, so
    // recipients got rows with no uploaded media.
    queuePendingShip(target);
    setSelectedClipIds(new Set());
  }

  /** Create-and-add from the AddToDropdown: the new playlist lands in the same
   * folder as the playlist being copied from (matches the sidebar + button
   * convention of inheriting selected?.folderId). Errors surface in the
   * dropdown's own catch so it can stay open for a retry. */
  async function handleCreatePlaylistAndAdd(name: string) {
    const created = await createPlaylist(name, selected?.folderId, activeOrgId ?? undefined);
    trackEvent('playlist_created', { playlist_id: created.id, in_folder: !!selected?.folderId })
    // Prepend before adding: both updates are functional, so the add handler's
    // map below sees the new playlist and its items update isn't lost.
    setPlaylists((prev) => [created, ...prev]);
    await handleAddSelectedToPlaylist(created);
    toast.success(`Created "${name}" and added the clips`);
  }

  // ---------------------------------------------------------------------------
  // Text card operations
  // ---------------------------------------------------------------------------

  /**
   * Where a new card goes. From the toolbar: after the focused (or playing)
   * row, else at the start, where an intro card belongs. From a row: above
   * it. Never inside a group: above or after the whole run instead.
   */
  type CardPlace = { at: "toolbar" } | { at: "above"; index: number } | { at: "start" };

  function cardInsertTarget(place: CardPlace): string | null {
    let gap: number;
    let after = false;
    if (place.at === "above") gap = place.index;
    else if (place.at === "start") gap = 0;
    else {
      const key = focusKey ?? activeKey;
      const idx = key ? sortedEvents.findIndex((i) => itemKey(i) === key) : -1;
      gap = idx >= 0 ? idx + 1 : 0;
      after = idx >= 0;
    }
    if (gap > 0 && gap < sortedEvents.length) {
      const gid = itemGroupIds.get(itemKey(sortedEvents[gap]));
      if (gid && itemGroupIds.get(itemKey(sortedEvents[gap - 1])) === gid) {
        if (after) while (gap < sortedEvents.length && itemGroupIds.get(itemKey(sortedEvents[gap])) === gid) gap++;
        else while (gap > 0 && itemGroupIds.get(itemKey(sortedEvents[gap - 1])) === gid) gap--;
      }
    }
    // The item the card goes before, by key, so a slow stats lookup can't misplace it.
    return sortedEvents[gap] ? itemKey(sortedEvents[gap]) : null;
  }

  /** Clips whose game has stats, in playlist order. */
  const statsClips = useMemo(
    () => sortedEvents.filter((i): i is QueueItem => !isTextCard(i) && statsKindOf(matchLookup.get((i as QueueItem).matchId)) !== null),
    [sortedEvents, matchLookup],
  );
  // The one-time suggestion for a player in their own space: "Show your stats in the video". A coach
  // isn't in the video, so it's never offered to one (the rule getting-started.tsx uses for a player).
  const isPlayer = activeOrgIsPersonal && profile?.declaredRole === "player";
  const [statsHintDismissed, setStatsHintDismissed] = useState<ReadonlySet<string>>(() => readStatsHintDismissed());
  const statsHint = useMemo(() => {
    if (!isPlayer || !selected || filtersActive || statsHintDismissed.has(selected.id)) return null;
    if (selected.items.some((i) => !isClipItem(i) && (i as PlaylistTextCard).card)) return null;
    const top = pickDefaultPlayer(statsClips.map((c) => c.event));
    if (!top || top.clips < 3) return null;
    return { severalGames: new Set(statsClips.map((c) => c.matchId)).size > 1 };
  }, [isPlayer, selected, filtersActive, statsHintDismissed, statsClips]);
  // The suggestion is only the question: the numbers are read when "Add stats card" is clicked, not when the playlist opens.

  function dismissStatsHint() {
    if (!selected) return;
    const next = new Set(statsHintDismissed).add(selected.id);
    setStatsHintDismissed(next);
    writeStatsHintDismissed(next);
    trackEvent("stats_card_suggestion_dismissed");
  }

  /** Their games, once each, in playlist order. */
  const statsGames = useMemo(() => {
    const seen = new Set<string>();
    return statsClips.flatMap((c) => {
      const m = matchLookup.get(c.matchId);
      if (!m || seen.has(m.id)) return [];
      seen.add(m.id);
      return [m];
    });
  }, [statsClips, matchLookup]);
  const statsCardDisabledReason = filtersActive
    ? "Clear filters to edit the playlist"
    : statsClips.length === 0
      ? "Needs clips from a game with league play-by-play"
      : null;

  /**
   * A new stats card's defaults: from a row, that clip's player and game;
   * otherwise the player with the most clips, in their most-clipped game.
   * One game shows its stat line; several games show the season averages.
   */
  async function defaultStatsCard(anchor?: QueueItem): Promise<StatsCardSpec | null> {
    const anchorOk = anchor && anchor.event.player && statsKindOf(matchLookup.get(anchor.matchId));
    const playing = statsClips.find((c) => c.matchId === activeMatchId && c.event.eventId === activeEventId);
    const personId = anchorOk
      ? String(anchor.event.player!.playerId)
      : pickDefaultPlayer(statsClips.map((c) => c.event), { activePlayerId: playing?.event.player?.playerId != null ? String(playing.event.player.playerId) : null })?.playerId;
    if (!personId) return null;
    const theirs = statsClips.filter((c) => String(c.event.player?.playerId) === personId);
    const counts = new Map<string, number>();
    for (const c of theirs) counts.set(c.matchId, (counts.get(c.matchId) ?? 0) + 1);
    const matchId = anchorOk ? anchor.matchId : [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const match = matchId ? matchLookup.get(matchId) : undefined;
    if (!match) return null;
    const stats = await loadGameStats(match, leagues);
    const option = stats?.players.find((p) => p.player.id === personId);
    if (!stats || !option) return null;
    const season = seasonOf(match, leagues);
    const severalGames = new Set(statsClips.map((c) => c.matchId)).size > 1;
    if (!anchorOk && severalGames && season) {
      const seasonPlayer = await loadSeasonPlayer(season.competitionId, personId).catch(() => null);
      if (seasonPlayer) return makeSeasonCard(season, option.player, seasonPlayer);
    }
    return makeGameCard(match, stats, option, season?.competitionId ?? null);
  }

  async function handleInsertCard(kind: "text" | "stats", place: CardPlace, entry: "menu" | "row" | "suggestion", anchor?: QueueItem) {
    // Inserting against a filtered (partial) list computes the wrong position.
    if (filtersActive || !selected) return;
    const playlistId = selected.id;
    const targetKey = cardInsertTarget(place);

    let spec: StatsCardSpec | null = null;
    if (kind === "stats") {
      const reading = toast.loading("Reading the official stats…");
      try {
        spec = await defaultStatsCard(anchor);
      } finally {
        toast.dismiss(reading);
      }
      if (!spec) {
        toast.error("No stats for this player in this game");
        return;
      }
    }
    const before = selectedRef.current;
    if (!before || before.id !== playlistId) return;

    const newCard: PlaylistTextCard = {
      type: 'text',
      id: crypto.randomUUID(),
      text: spec ? fallbackText(spec) : '',
      durationSeconds: 5,
      ...(spec ? { card: spec } : {}),
    };
    const found = targetKey ? before.items.findIndex((item) => playlistItemKey(item) === targetKey) : -1;
    const insertAt = found >= 0 ? found : before.items.length;
    const newItems: PlaylistItem[] = [...before.items.slice(0, insertAt), newCard, ...before.items.slice(insertAt)];
    setNewlyInsertedCardId(newCard.id);
    setFocusKey(`text:${newCard.id}`);
    setPendingShowCardId(newCard.id);
    if (!(await commitItemsEdit(before, newItems, spec ? "Add stats card" : "Add text card"))) return;
    if (spec) {
      trackEvent("stats_card_inserted", { entry, scope: spec.scope, source: spec.source, columns: spec.columns.length });
    } else {
      trackEvent("text_card_inserted", { entry });
    }
  }

  // Show a card just added, held on the stage, once the list has it.
  useEffect(() => {
    if (!pendingShowCardId) return;
    const item = queueItems.find((i) => isTextCard(i) && (i as PlaylistTextCard).id === pendingShowCardId);
    if (!item) return;
    setPendingShowCardId(null);
    handleRowClick(item);
  }, [pendingShowCardId, queueItems]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Stats card edits show at once and save after a pause in the typing.
  const statsSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  function handleStatsCardChange(id: string, spec: StatsCardSpec) {
    const pl = selectedRef.current;
    if (!pl) return;
    const text = fallbackText(spec);
    const newItems = pl.items.map((c) =>
      !isClipItem(c) && (c as PlaylistTextCard).id === id ? { ...c, card: spec, text } : c
    );
    const updated = { ...pl, items: newItems };
    selectedRef.current = updated;
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === pl.id ? updated : p));
    const timers = statsSaveTimersRef.current;
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      updateTextCard(pl.id, id, { card: spec, text }).catch(() => toast.error("Couldn't save the stats card. Try again."));
    }, 400));
  }


  // ---------------------------------------------------------------------------
  // The scouting report: its view, the playlist's live report, and what generating does
  // ---------------------------------------------------------------------------

  // A different playlist: the report view was the last one's (coming back opens the editor).
  useEffect(() => {
    setReportFor(null);
  }, [selected?.id]);

  /** Opens the playlist's report in place of the editor; nothing keeps playing behind it. */
  function openReport() {
    handleStop();
    videoRef.current?.pause();
    if (playerFs.active) void playerFs.exit();
    refreshMyReport();
    setReportFor(selectedRef.current?.id ?? null);
  }

  /** The coach's labels per clip, by name, for the report. */
  const labelNamesByClip = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const [key, ids] of clipAssignments) {
      const names = labels.filter((l) => ids.has(l.id)).map((l) => l.name);
      if (names.length > 0) out.set(key, names);
    }
    return out;
  }, [clipAssignments, labels]);


  /** Each playlist's report as last read this session: going back to a playlist doesn't read it again (opening the dialog and its changes still do). */
  const reportByPlaylistRef = useRef(new Map<string, MyScoutingReport | null>());
  const refreshMyReport = useCallback((opts?: { cached?: boolean }) => {
    const id = selected?.id;
    if (!id) {
      setMyReport(null);
      return;
    }
    if (opts?.cached && reportByPlaylistRef.current.has(id)) {
      setMyReport(reportByPlaylistRef.current.get(id) ?? null);
      return;
    }
    void getMyScoutingReport(id).then((r) => {
      reportByPlaylistRef.current.set(id, r);
      setMyReport((cur) => (selectedRef.current?.id === id ? r : cur));
    });
  }, [selected?.id]);
  useEffect(() => {
    refreshMyReport({ cached: true });
  }, [refreshMyReport]);
  const liveReport = myReport && new Date(myReport.expiresAt).getTime() > Date.now() ? myReport : null;

  /** Why the report can't be shared (a demo game), else null. */
  const reportShareDisabledReason = selected ? demoShipBlockReason(selected) : null;

  /** Prepares the clips and previews and publishes the report (lib/scouting-report.ts); the report view's share sheet drives it. */
  async function runReport(draft: ReportDraft, a: ScoutingReportRun): Promise<GenerateOutcome> {
    const pl = selectedRef.current;
    if (!pl) throw new Error("No playlist is open");
    // The footer mark follows the video watermark rule: always on Rookie, the Settings choice on Pro and Franchise.
    const canDisableWatermark = activeOrgPlan === "pro" || activeOrgPlan === "franchise";
    return generateScoutingReport({
      playlist: pl,
      draft,
      eventByKey,
      shipSegments: buildShipSegments(pl),
      clipSource: (matchId) => {
        const m = matchLookup.get(matchId);
        return m?.videoUrl && m.syncPoint ? { videoPath: m.videoUrl, syncPoint: m.syncPoint } : null;
      },
      matchLabel: (id) => matchLookup.get(id)?.title ?? "",
      labelsByKey: labelNamesByClip,
      preRoll,
      postRoll,
      title: draft.title ?? pl.name,
      opponent: draft.opponent ?? defaultOpponent(draft),
      attribution: !(canDisableWatermark && getExportWatermarkDisabled()),
      allowMissing: a.allowMissing,
      signal: a.signal,
      onProgress: a.onProgress,
      onShipped: (uploaded) => applyR2Urls(uploaded, pl.id),
    });
  }

  // ---------------------------------------------------------------------------

  // Machine-switch detection: matches sync via the DB but video files don't.
  // Probed per loaded match; gates export/share and swaps the silent black
  // player for an explanation + Locate action.
  const [videoStatusByMatch, setVideoStatusByMatch] = useState<Map<string, VideoFileStatus>>(new Map());
  // Re-probe on window focus (throttled): the user may have moved the file
  // back, or a transient probe hiccup recorded a false "missing" — either way
  // the gate self-heals when they return, without an app restart.
  const [probeTick, setProbeTick] = useState(0);
  const lastProbeAtRef = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastProbeAtRef.current < 30_000) return;
      setProbeTick((n) => n + 1);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  // Keyed on the PATHS (id:videoUrl), never on the matches array identity: an
  // event merge or a failed refresh re-running the probe against stale paths
  // used to overwrite a fresh relink's optimistic "ok" with "missing", leaving
  // export/share disabled while playback (which reads paths live) kept
  // working. Paths unchanged ⇒ no re-probe; `matches` in the closure is
  // captured on the same render the signature changed, so it's never staler
  // than the signature.
  const videoPathSignature = useMemo(
    () => clipMatches.map((m) => `${m.id}:${m.videoUrl ?? ""}`).join("\n"),
    [clipMatches],
  );
  useEffect(() => {
    if (clipMatches.length === 0) return;
    let cancelled = false;
    lastProbeAtRef.current = Date.now();
    probeMatches(clipMatches).then((map) => {
      if (!cancelled) setVideoStatusByMatch(map);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clipMatches is fully represented by videoPathSignature for probing purposes
  }, [videoPathSignature, probeTick]);

  /** Relink the ACTIVE game's video from the player overlay. */
  async function handleLocateActiveVideo() {
    const mId = activeMatchIdRef.current ?? (selected ? primaryMatchId(selected) : null);
    if (!mId) return;
    const result = await openFileDialog({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv", "webm", "m4v"] }],
    });
    if (typeof result !== "string") return;
    try {
      await updateVideoUrl(mId, result); // dispatches matches-changed → matches reload → re-probe
      // The src-swap effect keys on activeMatchId only — swap directly so the
      // player recovers without a re-navigation.
      setLocalVideoUrl(streamFileSrc(result));
      setVideoStatusByMatch((prev) => new Map(prev).set(mId, "ok"));
      toast.success("Video linked", {
        description: "Check a clip — if the timing looks off, redo the sync point in the game.",
      });
    } catch (e) {
      toast.error("Couldn't save the video link", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const hasAnyClips = queueItems.some((i) => !isTextCard(i));
  // Gate on the matches of clips ACTUALLY in the queue (exactly like
  // exportDisabledReason below) — NOT primaryMatchId, which is the
  // playlist's first clip ROW. Unresolvable clips are hidden from the queue
  // (legacy unscoped matches, a failed events fetch), so a playlist that
  // renders empty could still steer primaryMatchId at an invisible match
  // and false-alarm "No sync point" the moment real clips were added.
  const queueClipMatchIds = [
    ...new Set(queueItems.filter((i) => !isTextCard(i)).map((i) => (i as QueueItem).matchId)),
  ];
  const noSync =
    selected !== null && hasAnyClips && queueClipMatchIds.some((id) => !matchLookup.get(id)?.syncPoint);
  const noVideo =
    selected !== null && hasAnyClips && queueClipMatchIds.some((id) => !matchLookup.get(id)?.videoUrl);

  // Free users must stay able to CLICK export — the click is what opens the
  // UpgradeDialog. Mechanical blockers (demo game, missing video/sync) only
  // disable the button for paid users, who could otherwise actually export.
  const exportLocked = !exportAllowed;

  const exportDisabledReason = (() => {
    if (!selected || queueItems.length === 0) return filtersActive ? "No clips match the filters" : "Playlist is empty";
    const involvedMatchIds = new Set(
      queueItems.filter((i) => !isTextCard(i)).map((i) => (i as QueueItem).matchId)
    );
    for (const mId of involvedMatchIds) {
      const m = matchLookup.get(mId);
      if (m?.isDemo)
        return "The sample game can't be exported — import your own game to export";
      if (!m?.videoUrl || !isLocalPath(m.videoUrl))
        return "All games need a local video file for export";
      if (videoStatusByMatch.get(mId) === "missing" || videoStatusByMatch.get(mId) === "unreadable")
        return "A game's video file can't be found — open the game in the Library to locate it";
      if (!m.syncPoint)
        return "All games need a sync point for export";
    }
    return null;
  })();

  // ---------------------------------------------------------------------------
  // Browser panel toggle (dispatched by sidebar when already on /playlists)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handler = () => setBrowserCollapsed((v) => !v);
    window.addEventListener("playlist-browser-toggle", handler);
    return () => window.removeEventListener("playlist-browser-toggle", handler);
  }, []);

  // ---------------------------------------------------------------------------
  // Native menu: File → Export Playlist… (⌘E). menu-handler.tsx dispatches the
  // event; the item is only enabled while an exportable playlist is open
  // (menu-handler disables it again when this page unmounts).
  // ---------------------------------------------------------------------------

  const menuExportEnabled = !!selected && !exportDisabledReason && !isExporting;
  // ⌘E opens the same format step as the dropdown's "Save to computer…".
  const openExportPickerRef = useRef(openExportPicker);
  openExportPickerRef.current = openExportPicker;
  useEffect(() => {
    invoke("menu_set_enabled", { id: "export-playlist", enabled: menuExportEnabled }).catch(() => {});
    if (!menuExportEnabled) return;
    const handler = () => openExportPickerRef.current("save");
    window.addEventListener("menu-export-playlist", handler);
    return () => window.removeEventListener("menu-export-playlist", handler);
  }, [menuExportEnabled]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!profileLoading && !canAccess) return null;

  // Theater and split layouts render the SAME player and clip-list stacks —
  // they were duplicated verbatim before; only the ResizablePanel wrappers
  // and padding differ per layout. Edit these once for both.
  // The card on the stage as the playlist holds it now, so edits show at once.
  const stageCard = activeTextCard
    ? (selected?.items.find((i): i is PlaylistTextCard => i.type === 'text' && i.id === activeTextCard.id) ?? activeTextCard)
    : null;

  // A card (text or stats) is on the stage, not footage: the video's errors are about a clip, not about it.
  const cardOnStage = !!stageCard;

  const playerStack = localVideoUrl || stageCard ? (
      <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
        {/* Stage: in fullscreen it fills the layer; every overlay's coordinate
            system (crop window, keyframes, text cards) is the rendered video
            box in both cases. */}
        <div className={playerFs.active ? "relative min-h-0 flex-1" : "relative"}>
          <PlayerStage
            video={persistentVideo}
            src={localVideoUrl}
            fileMissing={
              !!activeMatchId &&
              videoStatusByMatch.get(activeMatchId) !== undefined &&
              videoStatusByMatch.get(activeMatchId) !== "ok" &&
              !cardOnStage
            }
            onCard={cardOnStage}
            fullscreen={playerFs.active}
            onToggleFullscreen={toggleFullscreen}
            onExitFullscreen={() => void playerFs.exit()}
            title={selected?.name}
            position={listPosition >= 0 ? { index: listPosition, total: playableItems.length } : null}
            clipWindow={
              activeClipKey && activeClipCrop.start !== null && activeClipCrop.end !== null
                ? { start: activeClipCrop.start, end: activeClipCrop.end }
                : null
            }
            markers={cropMode ? activeClipCrop.keyframes : undefined}
            onSeek={handleCropSeek}
            transport={{
              canPrev,
              canNext,
              isQueueActive,
              onPrev: handlePrev,
              onNext: handleNext,
              onReplay: handleReplay,
              onStop: handleStop,
              onPlayAll: () => startQueue(queueItems),
            }}
            speed={playbackSpeed}
            onSpeedChange={setPlaybackSpeed}
            interactive={!cropMode}
            hideChrome={!playerFs.active && !!stageCard}
            playback={stageCard ? { paused: cardPaused, toggle: toggleCard } : undefined}
            trimBar={
              trim ? (
                <ClipTrimmer
                  key={trim.key}
                  video={persistentVideo}
                  eventTime={trim.eventTime}
                  initial={{ start: trim.start, end: trim.end }}
                  onCancel={() => endTrim(null)}
                  onDone={(w) => endTrim(w)}
                />
              ) : undefined
            }
          >
            {cropMode && activeClipKey && !activeTextCard && (
              <CropOverlay
                videoRef={videoRef}
                keyframes={activeClipCrop.keyframes}
                dimmed={cropDimmed}
                onCommit={handleCropCommit}
              />
            )}
            {activeMatchId &&
              videoStatusByMatch.get(activeMatchId) !== undefined &&
              videoStatusByMatch.get(activeMatchId) !== "ok" &&
              !cardOnStage && (
              <div
                className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <VideoOff className="size-8 text-amber-400" />
                <p className="text-sm font-medium text-white">
                  This game's video file can't be found
                </p>
                <p className="max-w-sm text-xs text-white/70">
                  It may have been moved or renamed, or it's on another computer.
                  Point Scoutable at the file to keep working.
                </p>
                <Button size="sm" onClick={handleLocateActiveVideo}>
                  Locate file…
                </Button>
              </div>
            )}
            {stageCard && (
              <div className="absolute inset-0 z-10 bg-black">
                <CardImage source={stageCard} aspect="16:9" className="size-full" />
              </div>
            )}
          </PlayerStage>
        </div>
        {!playerFs.active && (
          <div className="flex flex-col gap-2">
            {stageCard?.card && (
              <StatsCardInspector
                cardId={stageCard.id}
                spec={stageCard.card}
                durationSeconds={stageCard.durationSeconds}
                games={statsGames}
                leagues={leagues}
                onChange={(spec) => handleStatsCardChange(stageCard.id, spec)}
                onDurationChange={(n) => handleTextCardDurationChange(stageCard.id, n)}
                onHold={pauseCard}
              />
            )}
            {activeClipKey && (
              <CropEditorBar
                active={cropMode}
                onToggle={() => setCropMode((v) => !v)}
                dimmed={cropDimmed}
                onToggleDimmed={() => setCropDimmed((v) => !v)}
                keyframeCount={activeClipCrop.keyframes?.length ?? 0}
                onRemoveAtPlayhead={handleCropRemoveAtPlayhead}
                onReset={() => setActiveClipCropKeyframes(null)}
              />
            )}
            {/* This clip's own length: the playlist's clip length plus the
                clip's offsets, shown as the seconds that actually play. */}
            {activeEventId !== null && (() => {
              // A trim can leave fractions: shown to the tenth, and the
              // steppers move on to whole seconds from there.
              const before = preRoll + activeClipOffsets.pre;
              const after = postRoll + activeClipOffsets.post;
              return (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
                  <span className="text-callout text-muted-foreground">This clip</span>
                  <div className="flex items-center gap-1.5">
                    <Stepper
                      label="Seconds before the play"
                      value={before}
                      min={0}
                      disabled={!!trim}
                      onChange={(n) => adjustActiveClip(stepToWhole(before, n) - before, 0)}
                      format={formatSeconds}
                    />
                    <span className="text-callout text-muted-foreground">before</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Stepper
                      label="Seconds after the play"
                      value={after}
                      min={0}
                      disabled={!!trim}
                      onChange={(n) => adjustActiveClip(0, stepToWhole(after, n) - after)}
                      format={formatSeconds}
                    />
                    <span className="text-callout text-muted-foreground">after</span>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={!!trim || cropMode || !!activeTextCard}
                        onClick={startTrim}
                      >
                        <Scissors />
                        Trim…
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="flex items-center gap-1.5">
                      Drag the clip's start and end on the player
                      <Kbd>T</Kbd>
                    </TooltipContent>
                  </Tooltip>
                  {(activeClipOffsets.pre !== 0 || activeClipOffsets.post !== 0) && !trim && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => adjustActiveClip(-activeClipOffsets.pre, -activeClipOffsets.post)}
                      title={`Back to the playlist's ${preRoll} s before and ${postRoll} s after`}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              );
            })()}
            {activeClipKey && activeOrgId && (() => {
              const key = `${activeClipKey.matchId}:${activeClipKey.eventId}`;
              const assignedIds = clipAssignments.get(key) ?? new Set<string>();
              const assigned = labels.filter((l) => assignedIds.has(l.id));
              return (
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  <LabelPickerPopover
                    trigger={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-separator transition-[background-color,color,transform] duration-100 hover:bg-fill-1 hover:text-primary active:scale-95"
                        title="Labels"
                      >
                        <Tag className="size-3" />
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
                  />
                  {assigned.map((l) => <LabelChip key={l.id} label={l} />)}
                </div>
              );
            })()}
            {activeEventId !== null && (
              <textarea
                className="w-full resize-none rounded-md bg-card px-3 py-2 text-sm text-foreground ring-1 ring-separator outline-none transition-[box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-selection"
                rows={2}
                placeholder="Add a note for this clip…"
                value={clipNote}
                onChange={(e) => handleNoteChange(e.target.value)}
              />
            )}
          </div>
        )}
      </div>
    ) : (
      <div className="space-y-2">
        <VideoPlaceholder />
        {noVideo && selected.items.filter(isClipItem).length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            No video linked. Add one in the game.
          </p>
        )}
      </div>
    );

  const shownClipCount = queueItems.filter((i) => !isTextCard(i)).length;
  const totalClipCount = sortedEvents.filter((i) => !isTextCard(i)).length;
  const clipListStack = (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      {statsHint && (
        <Callout className="mb-3 shrink-0" icon={<BarChart3 />}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="min-w-0 flex-1">
              {statsHint.severalGames ? "Show your season averages in the video" : "Show your stats in the video"}
            </span>
            <span className="flex shrink-0 gap-1.5">
              <Button size="xs" variant="ghost" onClick={dismissStatsHint}>
                Not now
              </Button>
              <Button size="xs" variant="outline" onClick={() => void handleInsertCard("stats", { at: "start" }, "suggestion")}>
                Add stats card
              </Button>
            </span>
          </div>
        </Callout>
      )}
      {noSync && selected.items.filter(isClipItem).length > 0 && (
        <Callout tone="warning" className="mb-3 shrink-0">
          No sync point. Set one in the game to play these clips.
        </Callout>
      )}

      {/* Filters sit above the scroller, so they stay put while the list
          moves. Opening, closing and the collapsed strip spring the height
          and cross-fade (a fade only under reduced motion). */}
      <AutoHeight className="shrink-0">
        <AnimatePresence mode="popLayout" initial={false}>
          {filtersOpen ? (
            <motion.div key="filter-bar" variants={revealVariants} initial="hidden" animate="visible" exit="exit" className="pb-2">
              <PlaylistFilterBar
                filters={queueFilters}
                onChange={(next) => {
                  if (!filtersActive && queueFiltersActive(next)) trackEvent("playlist_filtered");
                  setQueueFilters(next);
                }}
                options={queueFilterOptions}
                shownCount={shownClipCount}
                totalCount={totalClipCount}
              />
            </motion.div>
          ) : filtersActive ? (
            <motion.div key="filtered" variants={revealVariants} initial="hidden" animate="visible" exit="exit" className="pb-2">
              <div className="flex min-h-8 items-center gap-2 rounded-md bg-fill-1 py-1 pr-1 pl-3 text-callout text-muted-foreground">
                <ListFilter className="size-3.5 shrink-0" aria-hidden />
                <span className="nums">
                  Filtered: {shownClipCount} of {totalClipCount} clips
                </span>
                <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setQueueFilters({ ...EMPTY_QUEUE_FILTERS })}>
                  Clear
                </Button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AutoHeight>

      <div
        ref={playlistScrollRef}
        className={cn("min-h-0 flex-1 overflow-y-auto", selectedClipIds.size > 0 && "pb-16")}
        // A click on the list's empty space lets go of the selection, as in Finder.
        onClick={(e) => {
          if (e.target === e.currentTarget && !e.metaKey && !e.shiftKey && selectedClipIds.size > 0) setSelectedClipIds(new Set());
        }}
      >
      {queueItems.length === 0 ? (
        <div
          className={cn(
            "flex min-h-full flex-col items-center justify-center rounded-window ring-2 ring-inset transition-[box-shadow,background-color] duration-150",
            clipDropGap === 0 ? "bg-primary/5 ring-selection" : "ring-transparent",
          )}
        >
          <EmptyState
            icon={<ListVideo />}
            title="No clips yet"
            body="Add plays from your games, or drag clips in from another playlist."
            action={
              <Button
                size="sm"
                className={cn(hl("add-clips"))}
                onClick={() => { setOnboardingHighlight(null); setShowClipBrowser(true); }}
              >
                <Plus />
                Add clips
              </Button>
            }
          />
        </div>
      ) : (
        <div
          ref={gridRef}
          role="grid"
          aria-label="Clips"
          aria-multiselectable="true"
          aria-activedescendant={focusKey !== null ? rowDomId(focusKey) : undefined}
          tabIndex={0}
          onFocus={(e) => {
            // Tabbing in shows where the keys will act.
            if (e.target !== e.currentTarget || lastInputRef.current !== "keyboard") return;
            setKeyboardNav(true);
            if (focusKey === null) setFocusKey(activeKey ?? visibleKeys[0] ?? null);
          }}
          className="overflow-hidden rounded-window bg-card ring-1 ring-separator outline-none [&>[role=row]:not(:first-child)]:shadow-[inset_0_1px_0_var(--separator)]"
        >
          {queueItems.map((item, index) => {
            const key = itemKey(item);
            const drag = { rowKey: key, onPointerDown: (e: React.PointerEvent) => listDrag.onRowPointerDown(e, key) };
            const focused = keyboardNav && focusKey === key;
            // One of several selected rows: its own actions act on the whole selection.
            const inSelection = selectedClipIds.size > 1 && selectedClipIds.has(key);
            if (isTextCard(item)) {
              const card = item as PlaylistTextCard;
              return (
                <TextCardRow
                  key={key}
                  domId={rowDomId(key)}
                  card={card}
                  index={index}
                  isActive={key === activeKey}
                  focused={focused}
                  isSelected={selectedClipIds.has(key)}
                  anySelected={selectedClipIds.size > 0}
                  onSelect={(e) => handleRowCheckbox(key, e)}
                  drag={drag}
                  onClick={(e) => handleRowPress(card, e)}
                  onTextChange={handleTextCardTextChange}
                  onTextSave={handleTextCardTextSave}
                  onDurationChange={handleTextCardDurationChange}
                  onRemove={inSelection ? handleRemoveSelected : () => handleRemoveSingleTextCard(card)}
                  removeCount={inSelection ? selectedClipIds.size : 1}
                  onInsertTextCardAbove={filtersActive ? undefined : () => void handleInsertCard("text", { at: "above", index }, "row")}
                  onInsertStatsCardAbove={statsCardDisabledReason ? undefined : () => void handleInsertCard("stats", { at: "above", index }, "row")}
                  autoFocusText={card.id === newlyInsertedCardId && !card.card}
                  groupPos={!filtersActive ? groupRuns.get(key)?.pos : undefined}
                  groupSize={groupRuns.get(key)?.size}
                  onUngroup={!filtersActive && groupRuns.get(key) ? () => handleUngroup(groupRuns.get(key)!.groupId) : undefined}
                />
              );
            }
            const queueItem = item as QueueItem;
            const clip = clipByKey.get(key);
            return (
              <ClipRow
                key={key}
                domId={rowDomId(key)}
                index={index}
                event={queueItem.event}
                isActive={key === activeKey}
                focused={focused}
                isMultiMatch={isMultiMatch}
                matchTitle={matchLookup.get(queueItem.matchId)?.title}
                preOffset={clip?.preRollOffset ?? 0}
                postOffset={clip?.postRollOffset ?? 0}
                note={clip?.note}
                isSelected={selectedClipIds.has(key)}
                anySelected={selectedClipIds.size > 0}
                onSelect={(e) => handleRowCheckbox(key, e)}
                drag={drag}
                onClick={(e) => handleRowPress(queueItem, e)}
                onInsertTextCardAbove={filtersActive ? undefined : () => void handleInsertCard("text", { at: "above", index }, "row")}
                onInsertStatsCardAbove={
                  statsCardDisabledReason || !statsKindOf(matchLookup.get(queueItem.matchId)) || !queueItem.event.player
                    ? undefined
                    : () => void handleInsertCard("stats", { at: "above", index }, "row", queueItem)
                }
                onTrim={noSync ? undefined : () => trimRow(queueItem)}
                onRemove={inSelection ? handleRemoveSelected : () => { if (clip) handleRemoveSingleClip(clip); }}
                removeCount={inSelection ? selectedClipIds.size : 1}
                labelControls={activeOrgId ? {
                  labels,
                  assignedIds: clipAssignments.get(key) ?? new Set<string>(),
                  onToggle: (labelId, state) => handleToggleClipLabel(queueItem.matchId, queueItem.event.eventId, labelId, state),
                  selection: inSelection && selectedClipKeyPairs.length > 1
                    ? { count: selectedClipKeyPairs.length, allIds: bulkAssignedAll, someIds: bulkAssignedSome, onToggle: handleBulkToggleLabel }
                    : undefined,
                  onCreate: handleCreateLabel,
                  onRename: handleRenameLabel,
                  onRecolor: handleRecolorLabel,
                  onDelete: handleDeleteLabel,
                  onSeedDefaults: handleSeedDefaultLabels,
                } : undefined}
                groupPos={!filtersActive ? groupRuns.get(key)?.pos : undefined}
                groupSize={groupRuns.get(key)?.size}
                onUngroup={!filtersActive && groupRuns.get(key) ? () => handleUngroup(groupRuns.get(key)!.groupId) : undefined}
                canGroupSelection={!filtersActive && selectedClipIds.size >= 2}
                selectionCount={selectedClipIds.size}
                onGroupSelected={handleGroupSelected}
              />
            );
          })}
        </div>
      )}
      </div>

      <SelectionBar
        count={selectedClipIds.size}
        onRemove={handleRemoveSelected}
        onClear={() => setSelectedClipIds(new Set())}
        group={(() => {
          const keys = [...selectedClipIds];
          const gid = itemGroupIds.get(keys[0] ?? "");
          const groupTotal = gid ? [...itemGroupIds.values()].filter((g) => g === gid).length : 0;
          const isExactlyOneGroup = !!gid
            && keys.every((k) => itemGroupIds.get(k) === gid)
            && keys.length === groupTotal;
          if (isExactlyOneGroup) {
            return { kind: "ungroup" as const, disabled: filtersActive, onClick: () => void handleUngroup(gid!) };
          }
          if (keys.length >= 2) {
            return {
              kind: "group" as const,
              disabled: filtersActive,
              reason: filtersActive ? "Clear filters to group" : "Keep these items together when reordering",
              onClick: () => void handleGroupSelected(),
            };
          }
          return null;
        })()}
        labelPicker={selectedClipKeyPairs.length > 0 ? (
          <LabelPickerPopover
            trigger={
              <PillButton title="Labels">
                <Tag />
                <span className={PILL_LABEL}>Label</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </PillButton>
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
            side="top"
          />
        ) : null}
        addTo={
          <AddToPopover
            playlists={playlists.filter((p) => !isUnsavedId(p.id))}
            activePlaylistId={selected?.id ?? null}
            onAddToPlaylist={handleAddSelectedToPlaylist}
            onCreatePlaylist={handleCreatePlaylistAndAdd}
            trigger={
              <PillButton title="Add to another playlist">
                <ListPlus />
                <span className={PILL_LABEL}>Add to</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </PillButton>
            }
          />
        }
      />
    </div>
  );

  return (
    <>
    <Page>
    {selected && !reportView ? (
      <EditorToolbar
        name={selected.name}
        itemCount={selected.items.length}
        isMultiMatch={isMultiMatch}
        editing={editingPlaylistId === selected.id && editingVia === "header"}
        editValue={editPlaylistName}
        onEditValueChange={setEditPlaylistName}
        onStartRename={() => { setEditingVia("header"); setEditingPlaylistId(selected.id); setEditPlaylistName(selected.name); }}
        onCommitRename={() => handleRenamePlaylist(selected.id)}
        onCancelRename={() => setEditingPlaylistId(null)}
        onDeletePlaylist={() => setDeleteTarget(selected)}
        theaterMode={theaterMode}
        onTheaterModeChange={setTheaterMode}
        isPlaying={isPlaying}
        playDisabled={queueItems.length === 0 || noSync}
        playLabel={filtersActive ? `Play ${queueItems.filter((i) => !isTextCard(i)).length} filtered` : "Play"}
        onPlay={() => startQueue(queueItems)}
        onStop={handleStop}
        onAddClips={() => { setOnboardingHighlight(null); setShowClipBrowser(true); }}
        highlightAddClips={onboardingHighlight === "add-clips"}
        filtersOpen={filtersOpen}
        filtersActive={filtersActive}
        activeFilterDims={activeFilterDims}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        onAddTextCard={() => void handleInsertCard("text", { at: "toolbar" }, "menu")}
        addTextCardDisabledReason={filtersActive ? "Clear filters to edit the playlist" : null}
        onAddStatsCard={() => void handleInsertCard("stats", { at: "toolbar" }, "menu")}
        addStatsCardDisabledReason={statsCardDisabledReason}
        onOpenReport={openReport}
        reportStatus={liveReport ? `Shared · expires ${formatCardDate(liveReport.expiresAt)}` : null}
        preRoll={preRoll}
        postRoll={postRoll}
        onPreRollChange={setPreRoll}
        onPostRollChange={setPostRoll}
        clockSort={clockSort}
        clockSortLocked={clockSortLocked}
        onClockSortChange={setClockSort}
        hasItems={queueItems.length > 0}
        onSelectAll={() => setSelectedClipIds(new Set(queueItems.map(itemKey)))}
        exportLocked={exportLocked}
        exportLockedTitle={playerMode ? "Export opens when you buy a game or go Pro" : undefined}
        exportDisabledReason={exportDisabledReason}
        isExporting={isExporting}
        onStopExport={stopExport}
        exportProgress={exportProgress}
        exportLabel={
          selectedClipIds.size > 0
            ? `Export ${selectedClipIds.size} selected`
            : filtersActive
              ? `Export ${queueItems.filter((i) => !isTextCard(i)).length} filtered`
              : "Export"
        }
        highlightExport={onboardingHighlight === "export"}
        onExport={openExportPicker}
        onExportMenuOpen={() => setOnboardingHighlight(null)}
        shareVisible={userTeams.length > 0}
        isShipping={isShipping}
        shipLabel={shipProgress ? `${shipProgress.done} of ${shipProgress.total}` : null}
        isShared={(selected.teamIds?.length ?? 0) > 0 || (selected.userIds?.length ?? 0) > 0}
        sharedLabel={(() => {
          const teamNames = (selected.teamIds ?? []).map((id) => userTeams.find((t) => t.id === id)?.name ?? "Team");
          const userCount = selected.userIds?.length ?? 0;
          const parts: string[] = [];
          if (teamNames.length > 0) parts.push(teamNames.join(", "));
          if (userCount > 0) parts.push(`${userCount} member${userCount !== 1 ? "s" : ""}`);
          return parts.join(" · ");
        })()}
        shareDisabledReason={exportDisabledReason}
        highlightShare={onboardingHighlight === "share"}
        onShare={() => {
          setOnboardingHighlight(null);
          setPendingShareTeamIds(new Set(selected.teamIds ?? []));
          setPendingShareUserIds(new Set(selected.userIds ?? []));
          setShareDialogOpen(true);
        }}
      />
    ) : selected ? (
      // Holds the toolbar's height from the first frame, so nothing below jumps while the report fills it.
      <div ref={setReportToolbarSlot} className="h-[var(--toolbar-height)] shrink-0" />
    ) : (
      <Toolbar
        variant="static"
        title="Playlists"
        actions={
          <Button size="sm" onClick={() => handleNewPlaylist()}>
            <ListPlus />
            New playlist
          </Button>
        }
      />
    )}
    <div className="flex min-h-0 flex-1">
      {/* LEFT — the playlist browser, a source list in its own column */}
      <BrowserColumn
        collapsed={browserCollapsed}
        width={browserWidth}
        onWidthChange={setBrowserWidth}
        onCollapse={() => setBrowserCollapsed(true)}
        onExpand={(w) => {
          setBrowserWidth(w);
          setBrowserCollapsed(false);
        }}
        className="bg-card"
      >
        <div className="flex h-11 shrink-0 items-center gap-1 px-3">
          <SearchField
            className="min-w-0 flex-1"
            placeholder="Search"
            aria-label="Search playlists"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="New folder" onClick={() => handleNewFolder()}>
                <FolderPlus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New folder</TooltipContent>
          </Tooltip>
        </div>

        <div ref={sidebarScrollRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {loading ? (
          <div className="flex flex-col gap-1 px-2 py-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-fill-1" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
            ))}
          </div>
        ) : playlists.length === 0 && folders.length === 0 ? (
          <EmptyState
            icon={<ListVideo />}
            title="No playlists yet"
            body="Give one a name and add clips from your games."
            action={
              <Button size="sm" variant="outline" onClick={() => handleNewPlaylist()}>
                New playlist
              </Button>
            }
          />
        ) : search.trim() && filteredPlaylists.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No matches for &ldquo;{search}&rdquo;</p>
        ) : (
          <div className="py-1">
            {/* Folder tree (roots; renderFolderNode recurses) */}
            {(childFolders.get(null) ?? []).map((folder) => renderFolderNode(folder, 0))}

            {/* Uncategorized: a section only once there are folders to be apart from */}
            {(() => {
              const items = byFolder.get(null) ?? [];
              if (items.length === 0) return null;
              const sectioned = folders.length > 0;
              const isExpanded = !sectioned || search.trim() ? true : uncategorizedExpanded;
              const isDragOver = dragOverFolder === "uncategorized";
              return (
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragOverFolder("uncategorized");
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverFolder("uncategorized");
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverFolder(null);
                  }}
                  onDrop={(e) => handleDrop(null, e)}
                >
                  {sectioned &&
                    renderSectionHeader({
                      id: "uncategorized",
                      label: "Uncategorized",
                      count: items.length,
                      expanded: isExpanded,
                      dragOver: isDragOver,
                      springLoading: clipExpandFolderId === "uncategorized",
                      onToggle: () => setUncategorizedExpanded((v) => !v),
                    })}
                  {isExpanded && items.map((pl) => renderPlaylistRow(pl, 0))}
                </div>
              );
            })()}

            {/* Shared by me */}
            {(() => {
              const sharedPlaylists = playlists.filter((p) => (p.teamIds?.length ?? 0) > 0);
              if (sharedPlaylists.length === 0) return null;
              return (
                <div className="mt-1">
                  {renderSectionHeader({
                    id: "shared",
                    label: "Shared by me",
                    count: sharedPlaylists.length,
                    expanded: sharedSectionExpanded,
                    onToggle: () => setSharedSectionExpanded((v) => !v),
                  })}
                  {sharedSectionExpanded &&
                    sharedPlaylists.map((pl) => {
                      const isActive = selected?.id === pl.id;
                      const teamNames = (pl.teamIds ?? [])
                        .map((id) => userTeams.find((t) => t.id === id)?.name)
                        .filter(Boolean)
                        .join(", ");
                      return (
                        <div
                          key={pl.id}
                          data-playlist-id={pl.id}
                          className={cn(
                            "group mx-2 flex min-h-7 cursor-default select-none items-center gap-1.5 rounded-md px-2 py-1 transition-[background-color,box-shadow] duration-100",
                            isActive ? "bg-selection text-selection-foreground" : "text-foreground hover:bg-fill-1 active:bg-fill-2",
                            clipDragOverPlaylistId === pl.id && "bg-selection/20 ring-2 ring-inset ring-selection",
                          )}
                          onClick={() => selectPlaylist(pl)}
                        >
                          <Users className={cn("size-4 shrink-0", isActive ? "text-selection-foreground" : "text-primary")} />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm leading-tight">{pl.name}</span>
                            {teamNames && (
                              <span className={cn("truncate text-footnote", isActive ? "text-selection-foreground/70" : "text-muted-foreground")}>
                                {teamNames}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded-sm opacity-0 outline-none transition-[opacity,background-color] duration-100 group-hover:opacity-100 focus-visible:opacity-100",
                              isActive ? "text-selection-foreground hover:bg-white/20" : "text-muted-foreground hover:bg-fill-2 hover:text-foreground",
                            )}
                            title="Manage sharing"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectPlaylist(pl);
                              setPendingShareTeamIds(new Set(pl.teamIds ?? []));
                              setShareDialogOpen(true);
                            }}
                          >
                            <Share2 className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                </div>
              );
            })()}

            {/* Strip below the sections: right-click to create at root,
                drop to move a folder to root / a playlist to Uncategorized.
                (Folders can also be moved via their right-click "Move to".) */}
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  className="h-12"
                  onDragOver={(e) => {
                    if (
                      !e.dataTransfer.types.includes("text/folder-id") &&
                      !e.dataTransfer.types.includes("text/playlist-id")
                    ) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => handleDrop(null, e)}
                />
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => handleNewPlaylist(null)}>
                  New Playlist
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => handleNewFolder()}>
                  New Folder
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        )}
        </div>

        {!loading && (
          <div className="shrink-0 border-t border-separator p-1.5">
            <button
              type="button"
              onClick={() => handleNewPlaylist()}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-sm text-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
            >
              <ListPlus className="size-4 text-primary" />
              New Playlist
            </button>
          </div>
        )}
      </BrowserColumn>

      {/* RIGHT — the editor */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {selected === null ? (
          <div className="flex flex-1 items-center justify-center p-12">
            <EmptyState
              icon={<ListVideo />}
              title="Select a playlist"
              body="Choose one from the list, or start a new playlist and add clips to it."
              action={
                <Button size="sm" variant="outline" onClick={() => handleNewPlaylist()}>
                  New playlist
                </Button>
              }
            />
          </div>
        ) : (
          <>
          {reportView ? (
            <ReportView
              key={selected.id}
              toolbarSlot={reportToolbarSlot}
              playlist={selected}
              eventByKey={eventByKey}
              matchLookup={matchLookup}
              leagues={leagues}
              isMultiMatch={isMultiMatch}
              labels={labels}
              clipAssignments={clipAssignments}
              labelNamesByClip={labelNamesByClip}
              myReport={myReport}
              onRefreshReport={() => refreshMyReport()}
              blockedByPlan={activeOrgPlan === 'free'}
              onUpgrade={() => { setUpsellReport(true); setUpgradeDialogOpen(true); }}
              shareDisabledReason={reportShareDisabledReason}
              runReport={runReport}
              onBack={() => setReportFor(null)}
              onOpenClip={(key) => { pendingRevealKeyRef.current = key; setReportFor(null); }}
            />
          ) : (
          <div className="flex h-full flex-col gap-3 p-4">

            {/* Layout: horizontal split (default) or vertical theater mode */}
            {theaterMode ? (
              <ResizablePanelGroup key="theater" direction="vertical" autoSaveId="playlists-theater" className="min-h-0 flex-1">
                <ResizablePanel defaultSize="70" minSize="25">
                <div className="flex h-full flex-col gap-2 pb-3 min-w-0">
                {playerStack}
                </div>
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize="30" minSize="20">
                <div className="flex h-full flex-col gap-3 overflow-hidden pt-3">
                {clipListStack}
                </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            ) : (
              <ResizablePanelGroup key="split" direction="horizontal" autoSaveId="playlists-split" className="min-h-0 flex-1">
                <ResizablePanel defaultSize="45" minSize="20">
                <div className="flex h-full flex-col gap-3 overflow-hidden pr-3">
                {clipListStack}
                </div>
                </ResizablePanel>

                <ResizableHandle />

                <ResizablePanel defaultSize="55" minSize="20">
                <div className="flex h-full flex-col gap-2 pl-3 min-w-0">
                {playerStack}
                </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            )}
          </div>
          )}
          <Sheet open={showClipBrowser} onOpenChange={setShowClipBrowser}>
            <SheetContent>
              <ClipBrowserPanel
                matches={matches}
                matchLookup={matchLookup}
                playlist={selected}
                onAddClips={handleAddClips}
                activeOrgId={activeOrgId}
                labels={labels}
                labelAssignments={clipAssignments}
                onNeedEvents={ensureEventsFor}
                onNeedLabels={ensureLabelsFor}
                videoStatusByMatch={videoStatusByMatch}
                labelHandlers={{
                  onToggleClip: handleToggleClipLabel,
                  onBulkToggle: applyBulkLabel,
                  onCreate: handleCreateLabel,
                  onRename: handleRenameLabel,
                  onRecolor: handleRecolorLabel,
                  onDelete: handleDeleteLabel,
                  onSeedDefaults: handleSeedDefaultLabels,
                }}
              />
            </SheetContent>
          </Sheet>
          {/* Upgrade dialog — shown when free user tries a paid feature.
              With player passes on, a Free personal space gets the purchase
              sheet instead, and a purchase carries on with the export. */}
          <PurchaseSheet
            open={upgradeDialogOpen && playerMode && !upsellReport}
            onClose={() => setUpgradeDialogOpen(false)}
            title={upsellContext?.action === "send" ? "Send your tape to your phone" : "Save your tape as an MP4"}
            surface={upsellContext?.action === "send" ? "send_to_phone" : "export_playlist"}
            game={null}
            analyticsFeature={
              (upsellContext?.action === "send" ? "send_to_phone" : "export_playlist") +
              (upsellContext?.format === "9:16" ? "_vertical" : "")
            }
            onPurchased={() => setResumeExport(upsellContext ?? { action: "save", format: "16:9" })}
          />
          <UpgradeDialog
            open={upgradeDialogOpen && (!playerMode || upsellReport)}
            onClose={() => { setUpgradeDialogOpen(false); setUpsellReport(false); }}
            featureName={
              upsellReport
                ? "Share your scouting report"
                : upsellContext?.action === "send"
                  ? "Send your tape to your phone"
                  : "Save your tape as an MP4"
            }
            description={
              upsellReport
                ? "Send staff and players one link with every player, note and clip, or save it as a PDF. Cancel anytime."
                : undefined
            }
            analyticsFeature={
              upsellReport
                ? "scouting_report"
                : (upsellContext?.action === "send" ? "send_to_phone" : "export_playlist") +
                  (upsellContext?.format === "9:16" ? "_vertical" : "")
            }
          />
          {/* Send to phone — render + upload + QR */}
          <ExportFormatDialog
            action={exportFormatAction}
            onClose={() => setExportFormatAction(null)}
            onPick={handleFormatPicked}
            pannedClipCount={exportPanCounts.panned}
            clipCount={exportPanCounts.total}
          />
          <SendToPhoneDialog
            open={sendToPhoneOpen}
            onClose={() => { setSendToPhoneOpen(false); setSendToPhoneVertical(false); }}
            playlist={selected ? { id: selected.id, name: selected.name } : null}
            segments={sendToPhoneSegments}
            preRoll={preRoll}
            postRoll={postRoll}
            isSelection={selectedClipIds.size > 0}
            vertical={sendToPhoneVertical}
          />
          {/* Share dialog — multi-team. One dialog, three phases that
              cross-fade in place while its height springs. Mid-upload and
              resolve exit only through their own buttons. */}
          <Dialog
            open={shareDialogOpen}
            onOpenChange={(open) => {
              // Mid-upload and resolve states must exit through their own
              // buttons — dismissing would leave the outcome ambiguous.
              if (!open && sharePhase.kind !== "pick") return;
              setShareDialogOpen(open);
            }}
          >
            <DialogContent
              showCloseButton={sharePhase.kind === "pick"}
              onEscapeKeyDown={(e) => { if (sharePhase.kind !== "pick") e.preventDefault(); }}
              onInteractOutside={(e) => { if (sharePhase.kind !== "pick") e.preventDefault(); }}
            >
              <AutoHeight>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={sharePhase.kind}
                    variants={fadeVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="grid gap-4"
                  >
                    {sharePhase.kind === "uploading" ? (
                      <>
                        <DialogHeader>
                          <DialogTitle>Sharing playlist</DialogTitle>
                          <DialogDescription>Recipients are notified once every clip is watchable.</DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-2">
                          <ProgressBar
                            percent={
                              shipProgress && shipProgress.total > 0
                                ? Math.round((shipProgress.done / shipProgress.total) * 100)
                                : null
                            }
                          />
                          <p className="text-callout text-muted-foreground nums">
                            {shipProgress
                              ? `Uploading clip ${Math.min(shipProgress.done + 1, shipProgress.total)} of ${shipProgress.total}`
                              : "Preparing clips…"}
                          </p>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => shareAbortRef.current?.abort()}>
                            Cancel
                          </Button>
                        </DialogFooter>
                      </>
                    ) : sharePhase.kind === "resolve" ? (
                      <>
                        <DialogHeader>
                          <DialogTitle>
                            {sharePhase.result.failures.length} of {sharePhase.total} clips didn&apos;t upload
                          </DialogTitle>
                          <DialogDescription>
                            Uploaded clips are saved — trying again only retries the failed ones. Nothing has been
                            shared yet.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-1 rounded-md bg-fill-1 px-3 py-2">
                          {groupShipFailures(sharePhase.result.failures).map((g) => (
                            <p key={g.message} className="truncate text-callout text-muted-foreground" title={g.message}>
                              {g.message}
                              {g.count > 1 ? ` (${g.count})` : ""}
                            </p>
                          ))}
                          {sharePhase.result.failures.length > groupShipFailures(sharePhase.result.failures).reduce((n, g) => n + g.count, 0) && (
                            <p className="text-callout text-muted-foreground">and more…</p>
                          )}
                        </div>
                        <DialogFooter>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setShareDialogOpen(false);
                              setSharePhase({ kind: "pick" });
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              finishResolvedShare(sharePhase.teamIds, sharePhase.userIds, sharePhase.result, sharePhase.total)
                            }
                          >
                            Share without them
                          </Button>
                          <Button onClick={() => handleShareRetry(sharePhase)}>Try again</Button>
                        </DialogFooter>
                      </>
                    ) : (
                      <>
                        <DialogHeader>
                          <DialogTitle>Share playlist</DialogTitle>
                          <DialogDescription>Pick the teams and members who should see it.</DialogDescription>
                        </DialogHeader>
                        <ShareRecipients
                          teams={userTeams}
                          members={shareableMembers}
                          teamIds={pendingShareTeamIds}
                          userIds={pendingShareUserIds}
                          onToggleTeam={(id) =>
                            setPendingShareTeamIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                          onToggleUser={(id) =>
                            setPendingShareUserIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                        />
                        <DialogFooter>
                          {((selected?.teamIds?.length ?? 0) > 0 || (selected?.userIds?.length ?? 0) > 0) && (
                            <Button variant="ghost" className="mr-auto text-destructive" onClick={() => handleShare([], [])}>
                              Stop sharing
                            </Button>
                          )}
                          <Button variant="outline" onClick={() => setShareDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button onClick={() => handleShare([...pendingShareTeamIds], [...pendingShareUserIds])}>
                            Done
                          </Button>
                        </DialogFooter>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </AutoHeight>
            </DialogContent>
          </Dialog>
          </>
        )}
      </div>
    </div>
    </Page>

    {/* Playlist deletion is irreversible and unshares it everywhere.
        Lives at the page root (not inside the selected-playlist branch):
        deletion is triggered from the always-visible sidebar, so the dialog
        must exist even when no playlist is open. */}
    <Dialog
      open={!!deleteTarget}
      onOpenChange={(o) => { if (!o && !deletingPlaylist) setDeleteTarget(null); }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</DialogTitle>
          <DialogDescription>
            {deleteTarget && (() => {
              const clips = deleteTarget.items.filter(isClipItem).length;
              const shared =
                (deleteTarget.teamIds?.length ?? 0) + (deleteTarget.userIds?.length ?? 0) > 0;
              const parts: string[] = [];
              if (clips > 0) parts.push(`This deletes the playlist and its ${clips} clip${clips !== 1 ? "s" : ""}.`);
              if (shared) parts.push("Everyone it's shared with loses access.");
              parts.push("This can't be undone.");
              return parts.join(" ");
            })()}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={deletingPlaylist}
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={deletingPlaylist || !deleteTarget}
            onClick={() => void confirmDeletePlaylist()}
          >
            {deletingPlaylist ? "Deleting…" : "Delete playlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Subtree-delete confirmation — only opened for non-empty folders. */}
    <Dialog open={!!deleteFolderTarget} onOpenChange={(o) => !o && setDeleteFolderTarget(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete &quot;{deleteFolderTarget?.name}&quot;?</DialogTitle>
          <DialogDescription>
            {(() => {
              if (!deleteFolderTarget) return null;
              const stats = subtreeStats(folders, playlists, deleteFolderTarget.id);
              const parts: string[] = [];
              if (stats.folderCount > 0) {
                parts.push(
                  `This also deletes ${stats.folderCount} subfolder${stats.folderCount === 1 ? "" : "s"}.`,
                );
              }
              if (stats.playlistCount > 0) {
                parts.push(
                  `${stats.playlistCount} playlist${stats.playlistCount === 1 ? "" : "s"} will move to Uncategorized.`,
                );
              }
              return parts.join(" ");
            })()}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setDeleteFolderTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (deleteFolderTarget) void handleDeleteFolder(deleteFolderTarget.id);
              setDeleteFolderTarget(null);
            }}
          >
            Delete folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    </>
  );
}
