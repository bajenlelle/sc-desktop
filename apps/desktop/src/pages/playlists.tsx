import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "@/lib/auth-context";
import { trackEvent } from "@/lib/analytics";
import { Sentry } from "@/lib/sentry";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Filter,
  Folder,
  FolderPlus,
  Share2,
  Users,
  ListPlus,
  ListVideo,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Tag,
  VideoOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoPlaceholder } from "@/components/video-placeholder";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { listMatchesLight, listEventsForMatches, listFolders, createFolder, updateFolder, deleteFolder, updateVideoUrl } from "@/lib/matches-db";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { probeMatches, type VideoFileStatus } from "@/lib/video-probe";
import { usePlayerFullscreen } from "@/lib/use-player-fullscreen";
import { cn } from "@/lib/utils";
import { listPlaylists, createPlaylist, updatePlaylist, deletePlaylist, addClips, removeClips, reorderItems, updateClip, insertTextCard, updateTextCard, setPlaylistTeams, setPlaylistUsers, notifyPendingPlaylistShares } from "@/lib/playlists-db";
import { groupShipFailures, mergeShipResults, type ClipShipResult } from "@scoutable/shared/lib/ship-result";
import { listLabels, createLabel as apiCreateLabel, updateLabel as apiUpdateLabel, deleteLabel as apiDeleteLabel, seedDefaultLabels, listAssignmentsForClips, setClipAssignments as apiSetClipAssignments, bulkAssign as apiBulkAssign } from "@/lib/labels-db";
import { LabelChip } from "@/components/labels/LabelChip";
import { LabelPickerPopover, type LabelTriState } from "@/components/labels/LabelPickerPopover";
import type { Label, LabelColor, ClipKey } from "@scoutable/shared/types/labels";
import { eventLabel, formatGameClock, parseGameClock, playerName } from "@scoutable/shared/lib/events";
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
} from "@scoutable/shared/lib/playlist-matches";
import { getOrgContext, getOrgContextForOrg, getOrgMembers, getTeamMemberIds } from "@/lib/profile-db";
import { UpgradeDialog } from "@/components/upgrade-dialog";
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
import type { ExportProgress } from "@scoutable/shared/lib/export-progress";
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
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { NUDGE_FAR_SECONDS, NUDGE_SECONDS, nextShuttleRate, resolvePlayerKey } from "@scoutable/shared/lib/player-keys";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { dragBlockKeys, isSameOrder, itemsIndexForGap } from "@scoutable/shared/lib/list-reorder";
import { useReducedMotionSafe } from "@/lib/motion";
import { EmptyState } from "@/components/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AddToPopover } from "@/components/editor/add-to-popover";
import { BROWSER_WIDTH, BrowserColumn } from "@/components/editor/browser-column";
import { ClipBrowserPanel } from "@/components/editor/clip-browser-panel";
import { PILL_LABEL, PillButton, SelectionBar } from "@/components/editor/selection-bar";
import { useListDrag, type DragTarget } from "@/components/editor/use-list-drag";

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

// ---------------------------------------------------------------------------
// The playlist browser column remembers its width and whether it is shown.
// ---------------------------------------------------------------------------

const BROWSER_COLLAPSED_KEY = "scoutable_playlist_browser_collapsed";
const BROWSER_WIDTH_KEY = "scoutable_playlist_browser_width";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlaylistsPage() {
  const { user, activeOrgId, activeOrgPlan, activeOrgRole, activeOrgIsPersonal, myOrgs, profileLoading } = useAuth();
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
  // Which matches already have their play-by-play in `matches`. The mount load
  // covers only the games playlists reference; the clip browser can display
  // any game, so it asks for the rest on demand via ensureEventsFor.
  const loadedEventMatchIdsRef = useRef<Set<string>>(new Set());
  const eventFetchInFlightRef = useRef<Set<string>>(new Set());
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
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
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
  // Vertical-crop editor: overlay visible + "export view" dim toggle.
  const [cropMode, setCropMode] = useState(false);
  const [cropDimmed, setCropDimmed] = useState(false);
  // Fullscreen player (native window fullscreen + fixed stage layer).
  const playerFs = usePlayerFullscreen();
  const playerFsRef = useRef(playerFs);
  playerFsRef.current = playerFs;
  // View → Fullscreen Player (⌘⇧F) — same CustomEvent bridge as ⌘B.
  useEffect(() => {
    const handler = () => playerFsRef.current.toggle();
    window.addEventListener("player-fullscreen-toggle", handler);
    return () => window.removeEventListener("player-fullscreen-toggle", handler);
  }, []);
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
  // Map keyed `${matchId}:${eventId}` -> Set of labelIds assigned to that clip
  const [clipAssignments, setClipAssignments] = useState<Map<string, Set<string>>>(new Map());
  /** Bank-scoped assignments for the same clips — the label filter matches both scopes. */
  const [bankAssignments, setBankAssignments] = useState<Map<string, Set<string>>>(new Map());
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
  const activeTextCardRef = useRef<PlaylistTextCard | null>(null);
  useEffect(() => { activeTextCardRef.current = activeTextCard; }, [activeTextCard]);

  const [newlyInsertedCardId, setNewlyInsertedCardId] = useState<string | null>(null);

  // Item selection (clips and text cards)
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set()); // "matchId:eventId" or "text:uuid"

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
  useEffect(() => {
    const missing = [
      ...new Set(selectedClipKeys.map((c) => c.matchId)),
    ].filter((id) => !loadedEventMatchIdsRef.current.has(id));
    if (missing.length > 0) void ensureEventsFor(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedClipKeys is fully represented by selectedClipKeysKey
  }, [selectedClipKeysKey, ensureEventsFor]);

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

  // Load label assignments for the selected playlist's clips.
  // Scope is the active playlist's id — labels here are playlist-scoped.
  useEffect(() => {
    if (!activeOrgId || !selected) { setClipAssignments(new Map()); setBankAssignments(new Map()); return; }
    const clipKeys = selectedClipKeys;
    if (clipKeys.length === 0) { setClipAssignments(new Map()); setBankAssignments(new Map()); return; }
    const playlistScopeId = selected.id;
    const toMap = (rows: Awaited<ReturnType<typeof listAssignmentsForClips>>) => {
      const next = new Map<string, Set<string>>();
      for (const r of rows) {
        const key = `${r.matchId}:${r.eventId}`;
        const set = next.get(key) ?? new Set<string>();
        set.add(r.labelId);
        next.set(key, set);
      }
      return next;
    };
    listAssignmentsForClips(activeOrgId, clipKeys, playlistScopeId)
      .then((rows) => setClipAssignments(toMap(rows)))
      .catch((e) => console.error("listAssignmentsForClips:", e));
    // Bank scope too — the in-playlist label filter matches either scope.
    listAssignmentsForClips(activeOrgId, clipKeys, null)
      .then((rows) => setBankAssignments(toMap(rows)))
      .catch((e) => console.error("listAssignmentsForClips (bank):", e));
    // selectedClipKeysKey stands in for the clip set; `selected` is read only
    // for its id and that same set, so a same-key identity change is inert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, selected?.id, selectedClipKeysKey]);

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
        if (nextAssigned) trackEvent("label_applied", { bulk: false });
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
        if (mode === "add") trackEvent("label_applied", { bulk: true });
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

  /**
   * Event lookup by `matchId:eventId`, built once per matches change.
   *
   * Resolving a clip through `match.events.find(...)` scanned a full
   * play-by-play array (~500 events per game) for every clip, so a 150-clip
   * playlist cost ~75,000 comparisons on each recompute of the queue.
   */
  const eventByKey = useMemo(() => {
    const map = new Map<string, PlayByPlayEvent>();
    for (const m of matches) {
      for (const e of m.events) map.set(`${m.id}:${e.eventId}`, e);
    }
    return map;
  }, [matches]);

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

  // Resolve playlist clip items in display order (cross-match aware)
  const playlistEvents = useMemo((): QueueItem[] => {
    if (!selected) return [];
    return selected.items
      .filter(isClipItem)
      .map((clip) => {
        const event = eventByKey.get(`${clip.matchId}:${clip.eventId}`);
        return event ? { event, matchId: clip.matchId } : null;
      })
      .filter((x): x is QueueItem => x !== null);
  }, [selected, eventByKey]);

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
        const key = `${qi.matchId}:${ev.eventId}`;
        const assigned = clipAssignments.get(key);
        const bank = bankAssignments.get(key);
        let hit = false;
        for (const id of queueFilters.labelIds) {
          if (assigned?.has(id) || bank?.has(id)) { hit = true; break; }
        }
        if (!hit) return false;
      }
      return true;
    });
  }, [sortedEvents, filtersActive, queueFilters, clipAssignments, bankAssignments]);

  /** What the queue, playback, selection and export actually operate on. */
  const queueItems = filtersActive ? filteredEvents : sortedEvents;

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
    if (!curQueueItem || isTextCard(curQueueItem)) return;
    if (preDelta !== 0) {
      // A new start is worth seeing from the top.
      seekToItem(curQueueItem as QueueItem, newPre, newPost);
      return;
    }
    // Only the end moved: shorten or extend the running clip in place. A
    // restart here would make trimming the tail a stop-start exercise.
    const sp = matchLookupRef.current.get(curQueueItem.matchId)?.syncPoint;
    const videoTime = sp ? computeVideoTime((curQueueItem as QueueItem).event, sp) : null;
    if (videoTime !== null && clipEndRef.current !== undefined) {
      clipEndRef.current = Math.max(videoTime, videoTime + postRollRef.current + newPost);
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
    const idx = queueItems.findIndex((i) => itemKey(i) === itemKey(item));
    const queue = idx >= 0 ? queueItems.slice(idx) : [item];
    startQueue(queue);
  }

  const _sortedEventsRef = useRef(queueItems);
  _sortedEventsRef.current = queueItems;
  const _activeEventIdRef = useRef(activeEventId);
  _activeEventIdRef.current = activeEventId;
  const _handleRowClickRef = useRef(handleRowClick);
  _handleRowClickRef.current = handleRowClick;
  const _handleReplayRef = useRef(handleReplay);
  _handleReplayRef.current = handleReplay;

  const listPosition = useMemo(() => {
    if (activeTextCard) return queueItems.findIndex(i => isTextCard(i) && (i as PlaylistTextCard).id === activeTextCard.id);
    if (activeEventId !== null) return queueItems.findIndex(i => !isTextCard(i) && (i as QueueItem).event.eventId === activeEventId);
    return -1;
  }, [activeTextCard, activeEventId, queueItems]);
  const canPrev = listPosition > 0;
  const canNext = listPosition >= 0 && listPosition < queueItems.length - 1;

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

  // One key owner for the page (src/lib/key-scope.ts); the Add Clips sheet
  // registers its own scope on top while it is open. The handler closes
  // over the latest render, so no refs are needed for state.
  useKeyScope("editor", true);
  useHotkeys("editor", (e) => {
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
        playerFsRef.current.toggle();
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
      case "toggle-play": {
        e.preventDefault();
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
        if (selectedClipIds.size === 0) return;
        e.preventDefault();
        void handleRemoveSelected();
        return;
      case "select-all":
        if (queueItems.length === 0) return;
        e.preventDefault();
        setSelectedClipIds(new Set(queueItems.map(itemKey)));
        return;
      case "next":
      case "prev": {
        e.preventDefault();
        const items = _sortedEventsRef.current;
        if (items.length === 0) return;
        const cur = items.findIndex(i =>
          isTextCard(i) ? (i as PlaylistTextCard).id === activeTextCardRef.current?.id
                         : (i as QueueItem).event.eventId === _activeEventIdRef.current
        );
        const next = action === "next"
          ? cur === -1 ? 0 : Math.min(cur + 1, items.length - 1)
          : cur === -1 ? items.length - 1 : Math.max(cur - 1, 0);
        if (next !== cur || cur === -1) _handleRowClickRef.current(items[next]);
        return;
      }
    }
  });

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

  /**
   * Optimistic local update + persist positions and group membership. A
   * failed save puts the old order back and offers a retry, so the list
   * never keeps showing an order the server doesn't have.
   */
  async function applyItemsUpdate(newItems: PlaylistItem[]) {
    if (!selected) return;
    const before = selected;
    const updatedPlaylist = { ...selected, items: newItems };
    setPlaylists((prev) => prev.map((p) => p.id === before.id ? updatedPlaylist : p));
    setSelected(updatedPlaylist);
    try {
      await reorderItems(before.id, newItems);
    } catch (err) {
      console.error("[playlists] Failed to save the new order:", err);
      Sentry.captureException(err);
      setPlaylists((prev) => prev.map((p) => p.id === before.id ? before : p));
      setSelected((prev) => (prev && prev.id === before.id ? before : prev));
      toast.error("Couldn't save the new order", {
        action: { label: "Retry", onClick: () => void applyItemsUpdate(newItems) },
      });
    }
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
    await applyItemsUpdate(newItems);
  }

  async function handleUngroup(groupId: string) {
    if (!selected || filtersActive) return;
    const clipCount = selected.items.filter((it) => it.groupId === groupId).length;
    const newItems = selected.items.map((it) => {
      if (it.groupId !== groupId) return it;
      const { groupId: _g, ...rest } = it;
      return rest as PlaylistItem;
    });
    await applyItemsUpdate(newItems);
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
    setPlaylists((prev) => prev.map((p) => (p.id === target.id ? { ...p, items: newItems } : p)));
    setSelected((prev) => (prev && prev.id === target.id ? { ...prev, items: newItems } : prev));
    trackEvent("clip_added_to_playlist", { playlist_id: target.id, match_id: matchId });
    // Arm after the rows exist so updateClipR2Url has something to patch.
    void addClips(target.id, [newClip], itemsInsertIndex)
      .then(() => queuePendingShip(target))
      .catch((err) => {
        console.error("[playlists] Failed to add dropped clip to queue:", err);
        // Catching it here is what keeps the toast honest, but it also stops
        // the rejection reaching Sentry on its own — so report it.
        Sentry.captureException(err);
        const without = (items: PlaylistItem[]) => items.filter((i) => !(isClipItem(i) && isSame(i)));
        setPlaylists((prev) => prev.map((p) => (p.id === target.id ? { ...p, items: without(p.items) } : p)));
        setSelected((prev) => (prev && prev.id === target.id ? { ...prev, items: without(prev.items) } : prev));
        toast.error("Couldn't add the clip");
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
    snapGap: (gap, blockKeys) =>
      snapGapToGroupBoundary(gap, sortedEvents, itemKey, itemGroupIds, new Set(blockKeys)),
    onTarget: handleDragTarget,
    onDrop: ({ gap, blockKeys, anchorKey, foreign }) => {
      if (foreign) commitForeignDrop(anchorKey, gap);
      else commitReorder(gap, blockKeys);
    },
    onDropOnPlaylist: (playlistId, anchorKey) => void handleClipDropOnPlaylist(playlistId, anchorKey),
    onEnd: endClipDragBookkeeping,
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
        if (clip?.cropKeyframes) (seg as Extract<ExportSegment, { kind: 'clip' }>).cropKeyframes = clip.cropKeyframes;
        return seg;
      })
      .filter((x): x is ExportSegment => x !== null);
  }

  function handleSendToPhone(vertical = false) {
    if (activeOrgPlan === 'free') {
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
    if (activeOrgPlan === 'free') {
      setUpgradeDialogOpen(true);
      return;
    }
    setIsExporting(true);
    setExportError(null);
    setExportProgress(null);
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
      });
      if (exportedPath) {
        notifyExportSuccess(exportedPath);
        trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'success', selection_only: selectedClipIds.size > 0, ...(vertical ? { aspect: '9:16' } : {}) });
        // Completes the Getting Started "export a playlist" step (local-only
        // is fine — the checklist is a first-session aid, not a record).
        setHasExported(user?.id);
        window.dispatchEvent(new CustomEvent("playlist-exported"));
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
      trackEvent('video_exported', { playlist_id: selected!.id, clip_count: segmentCount, status: 'error', error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    } finally {
      setIsExporting(false);
      setExportProgress(null);
    }
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
          description: `${uploadedCount} clip${uploadedCount === 1 ? "" : "s"} are now in the cloud.`,
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
        alert(`Failed to create folder: ${err instanceof Error ? err.message : String(err)}`);
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
    return (
      <ContextMenu key={pl.id}>
        <ContextMenuTrigger asChild>
          <div
            data-playlist-id={pl.id}
            draggable={!isEditingThis}
            onDragStart={(e) => handleDragStart(pl.id, e)}
            onDragEnd={() => setDragOverFolder(null)}
            style={{ paddingLeft: 8 + depth * FOLDER_INDENT }}
            className={cn(
              "group mx-2 flex h-7 cursor-default select-none items-center gap-1.5 rounded-md pr-1.5 outline-none transition-[background-color,box-shadow] duration-100",
              isActive ? "bg-selection text-selection-foreground" : "text-foreground hover:bg-fill-1 active:bg-fill-2",
              isDropTarget && "bg-selection/20 ring-2 ring-inset ring-selection",
              clipOpenPlaylistId === pl.id && "animate-pulse",
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
    if (!selected || newClips.length === 0) return;
    const updatedItems = [...selected.items, ...newClips];
    const updatedPlaylist = { ...selected, items: updatedItems };
    setSelected(updatedPlaylist);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updatedPlaylist : p));
    await addClips(selected.id, newClips, selected.items.length);
    newClips.forEach((clip) => {
      trackEvent('clip_added_to_playlist', { playlist_id: selected.id, match_id: clip.matchId })
    })
    // Clips added to an already-shared playlist must ship immediately —
    // recipients can't see unshipped clips at all, and nothing else would
    // ever upload them (sharing only ships toward NEW recipients). Armed
    // after addClips so the rows exist before updateClipR2Url patches them.
    queuePendingShip(selected);
  }

  // ---------------------------------------------------------------------------
  // Clip selection helpers
  // ---------------------------------------------------------------------------

  const allSelected =
    queueItems.length > 0 &&
    queueItems.every((item) => selectedClipIds.has(itemKey(item)));

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
      setSelectedClipIds(new Set(queueItems.map(itemKey)));
    }
  }

  function handleRemoveSelected() {
    if (!selected || selectedClipIds.size === 0) return;
    const prevItems = selected.items;
    const survivors = prevItems.filter((c) => !selectedClipIds.has(playlistItemKey(c)));
    // Groups that fell below 2 members dissolve.
    const newItems = normalizeGroups(survivors);
    const groupsChanged = newItems.some((it, i) => it !== survivors[i]);
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));
    const clipKeysToRemove = prevItems.filter(isClipItem)
      .filter((c) => selectedClipIds.has(`${c.matchId}:${c.eventId}`))
      .map((c) => ({ matchId: c.matchId, eventId: c.eventId }));
    const textCardIdsToRemove = prevItems.filter((i) => !isClipItem(i))
      .filter((c) => selectedClipIds.has(`text:${(c as PlaylistTextCard).id}`))
      .map((c) => (c as PlaylistTextCard).id);
    const count = clipKeysToRemove.length + textCardIdsToRemove.length;
    setSelectedClipIds(new Set());

    // A slip waiting to happen, so it stays undoable for the life of the
    // toast; the rows only leave the server once it is gone.
    let undone = false;
    let committed = false;
    const commit = () => {
      if (undone || committed) return;
      committed = true;
      void (async () => {
        await removeClips(selected.id, clipKeysToRemove, textCardIdsToRemove);
        // removeClips only deletes rows — a dissolved survivor's group_id must
        // be NULLed explicitly.
        if (groupsChanged) await reorderItems(selected.id, newItems);
      })().catch((err) => {
        console.error("[playlists] Failed to remove items:", err);
        Sentry.captureException(err);
        toast.error("Couldn't remove the items");
      });
    };
    toast(`${count} item${count !== 1 ? "s" : ""} removed`, {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          // Restore the pre-removal array wholesale — also restores any
          // groupId the normalization dissolved.
          const restored = { ...updated, items: prevItems };
          setSelected(restored);
          setPlaylists((prev) => prev.map((p) => p.id === selected.id ? restored : p));
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  function handleRemoveSingleClip(item: PlaylistClipItem) {
    if (!selected) return;
    const prevItems = selected.items;
    const idx = prevItems.indexOf(item);
    // Groups that fell below 2 members dissolve with the removal.
    const survivors = prevItems.filter((_, i) => i !== idx);
    const newItems = normalizeGroups(survivors);
    const groupsChanged = newItems.some((it, i) => it !== survivors[i]);
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));

    let undone = false;
    const commit = () => {
      if (undone) return;
      removeClips(selected.id, [{ matchId: item.matchId, eventId: item.eventId }], []);
      // A dissolved survivor's group_id must be NULLed explicitly.
      if (groupsChanged) reorderItems(selected.id, newItems);
    };
    toast('Clip removed', {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          // Restore the pre-removal array wholesale — also restores any
          // groupId the normalization dissolved.
          const restored = { ...updated, items: prevItems };
          setSelected(restored);
          setPlaylists((prev) => prev.map((p) => p.id === selected.id ? restored : p));
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  function handleRemoveSingleTextCard(card: PlaylistTextCard) {
    if (!selected) return;
    const prevItems = selected.items;
    const idx = prevItems.indexOf(card);
    const survivors = prevItems.filter((_, i) => i !== idx);
    const newItems = normalizeGroups(survivors);
    const groupsChanged = newItems.some((it, i) => it !== survivors[i]);
    const updated = { ...selected, items: newItems };
    setSelected(updated);
    setPlaylists((prev) => prev.map((p) => p.id === selected.id ? updated : p));

    let undone = false;
    const commit = () => {
      if (undone) return;
      removeClips(selected.id, [], [card.id]);
      if (groupsChanged) reorderItems(selected.id, newItems);
    };
    toast('Text card removed', {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          const restored = { ...updated, items: prevItems };
          setSelected(restored);
          setPlaylists((prev) => prev.map((p) => p.id === selected.id ? restored : p));
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
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

  async function handleInsertTextCard(insertAboveIndex: number) {
    // Inserting against a filtered (partial) list computes the wrong
    // position — locked until filters clear (the toolbar buttons are
    // disabled too; this guards the per-row shortcut).
    if (filtersActive) return;
    if (!selected) return;
    const newCard: PlaylistTextCard = {
      type: 'text',
      id: crypto.randomUUID(),
      text: '',
      durationSeconds: 5,
    };
    // "Insert above" a mid-group row means above the whole group — inserting
    // inside the run would silently break its contiguity.
    let gap = insertAboveIndex;
    if (gap > 0 && gap < sortedEvents.length) {
      const gid = itemGroupIds.get(itemKey(sortedEvents[gap]));
      if (gid && itemGroupIds.get(itemKey(sortedEvents[gap - 1])) === gid) {
        while (gap > 0 && itemGroupIds.get(itemKey(sortedEvents[gap - 1])) === gid) gap--;
      }
    }
    // Find the target item in selected.items that corresponds to displayItems[gap]
    const targetDisplayItem = sortedEvents[gap];
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
    trackEvent("text_card_inserted");
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
    () => matches.map((m) => `${m.id}:${m.videoUrl ?? ""}`).join("\n"),
    [matches],
  );
  useEffect(() => {
    if (matches.length === 0) return;
    let cancelled = false;
    lastProbeAtRef.current = Date.now();
    probeMatches(matches).then((map) => {
      if (!cancelled) setVideoStatusByMatch(map);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- matches is fully represented by videoPathSignature for probing purposes
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
  const exportLocked = activeOrgPlan === 'free';
  const playlistEmpty = !selected || queueItems.length === 0;

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
  const playerStack = localVideoUrl ? (
      <div className={playerFs.active ? "fixed inset-0 z-50 flex flex-col bg-black" : "contents"}>
        {/* Stage: in fullscreen it fills the layer; every overlay's coordinate
            system (crop window, keyframes, text cards) is the rendered video
            box in both cases. */}
        <div className={playerFs.active ? "relative min-h-0 flex-1" : "relative"}>
          <PlayerStage
            video={persistentVideo}
            src={localVideoUrl}
            fullscreen={playerFs.active}
            onToggleFullscreen={() => playerFsRef.current.toggle()}
            onExitFullscreen={() => void playerFs.exit()}
            title={selected?.name}
            position={listPosition >= 0 ? { index: listPosition, total: queueItems.length } : null}
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
              !activeTextCard && (
              <div
                className="absolute inset-0 z-[12] flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center"
                onClick={(e) => e.stopPropagation()}
              >
                <VideoOff className="size-8 text-amber-400" />
                <p className="text-sm font-medium text-white">
                  This game's video file can't be found
                </p>
                <p className="max-w-sm text-xs text-white/70">
                  It may have been moved or renamed, or it's on another computer —
                  games reference the file in place, nothing is uploaded. Point
                  Scoutable at the file to keep working.
                </p>
                <Button size="sm" onClick={handleLocateActiveVideo}>
                  Locate file…
                </Button>
              </div>
            )}
            {activeTextCard && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black">
                <p className="px-8 text-center text-4xl font-semibold text-white">{activeTextCard.text}</p>
              </div>
            )}
          </PlayerStage>
        </div>
        {!playerFs.active && (
          <div className="flex flex-col gap-2">
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
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-separator transition-[background-color,color,transform] duration-100 hover:bg-fill-1 hover:text-primary active:scale-95"
                        title={scopeTitle}
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
                    scopeTitle={scopeTitle}
                    scopeHint="Visible only in this playlist"
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

  const clipListStack = (
    <div className="@container relative flex min-h-0 flex-1 flex-col">
      {noSync && selected.items.filter(isClipItem).length > 0 && (
        <div className="mb-3 shrink-0 rounded-md bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          No sync point — set one in the game to enable playback controls.
        </div>
      )}

      <div
        ref={playlistScrollRef}
        className={cn("min-h-0 flex-1 overflow-y-auto", selectedClipIds.size > 0 && "pb-16")}
      >
      {filtersOpen && (
        <PlaylistFilterBar
          filters={queueFilters}
          onChange={(next) => {
            if (!filtersActive && queueFiltersActive(next)) trackEvent("playlist_filtered");
            setQueueFilters(next);
          }}
          options={queueFilterOptions}
          shownCount={queueItems.filter((i) => !isTextCard(i)).length}
          totalCount={sortedEvents.filter((i) => !isTextCard(i)).length}
        />
      )}
      {filtersActive && !filtersOpen && (
        <div className="mb-2 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          Filtered: showing {queueItems.filter((i) => !isTextCard(i)).length} of{" "}
          {sortedEvents.filter((i) => !isTextCard(i)).length} clips
          <button
            type="button"
            onClick={() => setQueueFilters({ ...EMPTY_QUEUE_FILTERS })}
            className="font-medium underline underline-offset-2"
          >
            Clear
          </button>
        </div>
      )}
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
          role="grid"
          aria-label="Clips"
          className="overflow-hidden rounded-window bg-card ring-1 ring-separator [&>[role=row]:not(:first-child)]:shadow-[inset_0_1px_0_var(--separator)]"
        >
          {queueItems.map((item, index) => {
            const key = itemKey(item);
            const drag = { rowKey: key, onPointerDown: (e: React.PointerEvent) => listDrag.onRowPointerDown(e, key) };
            if (isTextCard(item)) {
              const card = item as PlaylistTextCard;
              return (
                <TextCardRow
                  key={key}
                  card={card}
                  index={index}
                  isActive={activeTextCard?.id === card.id}
                  isSelected={selectedClipIds.has(key)}
                  anySelected={selectedClipIds.size > 0}
                  onSelect={(e) => toggleSelectClip(key, e)}
                  drag={drag}
                  onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleSelectClip(key, e); return; } handleRowClick(card); }}
                  onTextChange={handleTextCardTextChange}
                  onTextSave={handleTextCardTextSave}
                  onDurationChange={handleTextCardDurationChange}
                  onRemove={() => handleRemoveSingleTextCard(card)}
                  groupPos={!filtersActive ? groupRuns.get(key)?.pos : undefined}
                  groupSize={groupRuns.get(key)?.size}
                  onUngroup={!filtersActive && groupRuns.get(key) ? () => handleUngroup(groupRuns.get(key)!.groupId) : undefined}
                />
              );
            }
            const queueItem = item as QueueItem;
            const rowKey = `${queueItem.matchId}:${queueItem.event.eventId}`;
            const clip = clipByKey.get(rowKey);
            return (
              <ClipRow
                key={key}
                index={index}
                event={queueItem.event}
                isActive={queueItem.event.eventId === activeEventId}
                isMultiMatch={isMultiMatch}
                matchTitle={matchLookup.get(queueItem.matchId)?.title}
                preOffset={clip?.preRollOffset ?? 0}
                postOffset={clip?.postRollOffset ?? 0}
                note={clip?.note}
                isSelected={selectedClipIds.has(key)}
                anySelected={selectedClipIds.size > 0}
                onSelect={(e) => toggleSelectClip(key, e)}
                drag={drag}
                onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleSelectClip(key, e); return; } handleRowClick(queueItem); }}
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
            scopeTitle={`Labels in ${selected?.name ?? "this playlist"}`}
            scopeHint="Visible only in this playlist"
          />
        ) : null}
        addTo={
          <AddToPopover
            playlists={playlists}
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
    {selected ? (
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
        onAddTextCard={() => handleInsertTextCard(sortedEvents.length)}
        addTextCardDisabledReason={filtersActive ? "Clear filters to edit the playlist" : null}
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
        exportDisabledReason={exportDisabledReason}
        isExporting={isExporting}
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
          setMemberSearchQuery("");
          setShareDialogOpen(true);
        }}
      />
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
          <Sheet open={showClipBrowser} onOpenChange={setShowClipBrowser}>
            <SheetContent>
              <ClipBrowserPanel
                matches={matches}
                matchLookup={matchLookup}
                playlist={selected}
                onAddClips={handleAddClips}
                onClose={() => setShowClipBrowser(false)}
                activeOrgId={activeOrgId}
                labels={labels}
                onNeedEvents={ensureEventsFor}
                videoStatusByMatch={videoStatusByMatch}
                labelHandlers={{
                  onCreate: handleCreateLabel,
                  onRename: handleRenameLabel,
                  onRecolor: handleRecolorLabel,
                  onDelete: handleDeleteLabel,
                  onSeedDefaults: handleSeedDefaultLabels,
                }}
              />
            </SheetContent>
          </Sheet>
          {/* Upgrade dialog — shown when free user tries a paid feature */}
          <UpgradeDialog
            open={upgradeDialogOpen}
            onClose={() => setUpgradeDialogOpen(false)}
            featureName={
              upsellContext?.action === "send"
                ? "Send your tape to your phone"
                : "Save your tape as an MP4"
            }
            analyticsFeature={
              (upsellContext?.action === "send" ? "send_to_phone" : "export_playlist") +
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
          {/* Share dialog — multi-team */}
          <Dialog
            open={shareDialogOpen}
            onOpenChange={(open) => {
              // Mid-upload and resolve states must exit through their own
              // buttons — dismissing would leave the outcome ambiguous.
              if (!open && sharePhase.kind !== "pick") return;
              setShareDialogOpen(open);
            }}
          >
            {sharePhase.kind === "uploading" ? (
              <DialogContent onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                  <DialogTitle>Sharing playlist</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    Recipients are notified once every clip is watchable.
                  </p>
                  <ProgressBar
                    percent={
                      shipProgress && shipProgress.total > 0
                        ? Math.round((shipProgress.done / shipProgress.total) * 100)
                        : null
                    }
                  />
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {shipProgress
                      ? `Uploading clip ${Math.min(shipProgress.done + 1, shipProgress.total)} of ${shipProgress.total}`
                      : "Preparing clips…"}
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => shareAbortRef.current?.abort()}>
                    Cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            ) : sharePhase.kind === "resolve" ? (
              <DialogContent onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
                <DialogHeader>
                  <DialogTitle>
                    {sharePhase.result.failures.length} of {sharePhase.total} clips didn&apos;t upload
                  </DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-1">
                  {groupShipFailures(sharePhase.result.failures).map((g) => (
                    <p key={g.message} className="truncate text-xs text-muted-foreground" title={g.message}>
                      {g.message}
                      {g.count > 1 ? ` (${g.count})` : ""}
                    </p>
                  ))}
                  {sharePhase.result.failures.length > groupShipFailures(sharePhase.result.failures).reduce((n, g) => n + g.count, 0) && (
                    <p className="text-xs text-muted-foreground">and more…</p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    Uploaded clips are saved — trying again only retries the failed ones. Nothing has
                    been shared yet.
                  </p>
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShareDialogOpen(false);
                      setSharePhase({ kind: "pick" });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      finishResolvedShare(sharePhase.teamIds, sharePhase.userIds, sharePhase.result, sharePhase.total)
                    }
                  >
                    Share without them
                  </Button>
                  <Button size="sm" onClick={() => handleShareRetry(sharePhase)}>
                    Try again
                  </Button>
                </DialogFooter>
              </DialogContent>
            ) : (
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
                        className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-fill-1${checked ? " bg-fill-2" : ""}`}
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
                              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-fill-1${checked ? " bg-fill-2" : ""}`}
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
            )}
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
