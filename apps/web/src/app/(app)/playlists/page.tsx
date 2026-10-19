"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Folder, FolderInput, FolderPlus, ListVideo, Loader2, MoreHorizontal, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { isEditorUser } from "@scoutable/shared/lib/app-nav";
import {
  buildDescendantMap,
  childFoldersByParent,
  collectSubtreeIds,
  flattenFolderTree,
  folderNavDirection,
  folderPathNames,
  folderTrail,
  placedFolderId,
  shownParentMap,
  subtreePlaylistCounts,
  subtreeStats,
} from "@scoutable/shared/lib/folder-tree";
import { listFolders, listMatchesLight } from "@scoutable/shared/lib/matches-db";
import { listPlaylists } from "@scoutable/shared/lib/playlists-db";
import type { Playlist, PlaylistFolder, StoredMatch } from "@scoutable/shared/types/match";
import type { OrgTeam } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { BrowserItem } from "@/components/folders/browser-item";
import { DeleteFolderDialog, type DeleteFolderRequest } from "@/components/folders/delete-folder-dialog";
import { DragCardView } from "@/components/folders/drag-card";
import { FolderNameDialog, type FolderNameRequest } from "@/components/folders/folder-name-dialog";
import { FOLDER_PARAM, goToFolder, isPendingFolder, playlistCountLabel, TOP_LEVEL_NAME } from "@/components/folders/folder-nav";
import { FolderRow } from "@/components/folders/folder-row";
import { FolderTrail } from "@/components/folders/folder-trail";
import { MoveToDialog, type MoveRequest } from "@/components/folders/move-to-dialog";
import { RowMenu } from "@/components/folders/row-menu";
import { useDialogState } from "@/components/folders/use-dialog-state";
import { useFolderDrag, type FolderDragItem } from "@/components/folders/use-folder-drag";
import { useFolderOps } from "@/components/folders/use-folder-ops";
import { DeletePlaylistDialog } from "@/components/playlist/delete-playlist-dialog";
import { PlaylistRow, playlistClipCount } from "@/components/playlist/playlist-row";
import { RenamePlaylistDialog } from "@/components/playlist/rename-playlist-dialog";
import { ShareDialog } from "@/components/playlist/share-dialog";
import { requestShipAfterShare, shareReadiness } from "@/components/playlist/share-readiness";
import { useNewPlaylist } from "@/components/playlist/use-new-playlist";
import { useNavUser } from "@/components/shell/nav";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { ToolbarSearch, focusToolbarSearch } from "@/components/shell/toolbar-search";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupedList } from "@/components/ui/group";
import { Kbd } from "@/components/ui/kbd";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMyCloudGames } from "@/lib/game-videos";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { getOrgContextForOrg } from "@/lib/profile-db";
import { createClient } from "@/lib/supabase/client";

const KEY_SCOPE = "playlists";
/** How far a folder's contents travel in from the side it was entered from. */
const PUSH_PX = 28;
const DESTRUCTIVE_ITEM = "text-destructive focus:bg-destructive focus:text-white";
/** Holds the title's line while a folder's name is still loading. */
const BLANK_TITLE = "\u00a0";

/** One row's ⋯ menu is open at a time; these name whose. */
const folderMenuKey = (id: string) => `folder:${id}`;
const playlistMenuKey = (id: string) => `playlist:${id}`;

function clipsLabel(playlist: Playlist): string {
  const clips = playlistClipCount(playlist);
  return `${clips} clip${clips === 1 ? "" : "s"}`;
}

/**
 * The user's own playlists in the active space, in folders the way Files
 * and Notes keep them: the open folder's subfolders first (with how many
 * playlists each holds), then its playlists. `?folder=<id>` is the open
 * folder, so Back, reloads and links land there; the toolbar shows the way
 * back up (a back button on phones, the path beside the sidebar). New
 * playlists and folders are made in the open folder.
 *
 * Playlists and folders move by dragging them onto a folder or a step of
 * the path, or with Move to… in their ⋯ menu (right-click and Shift+F10
 * open it too); every move is optimistic and can be undone from its toast.
 * Deleting a folder that has something in it asks first and says what
 * happens to the playlists inside. Search looks through every folder and
 * shows where each hit lives. `N` is a new playlist, `⇧N` a new folder,
 * `/` search.
 */
export default function PlaylistsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get(FOLDER_PARAM);
  const { activeOrgId, activeOrgIsPersonal, myOrgs, profileLoading } = useAuth();
  const navUser = useNavUser();
  const editor = navUser ? isEditorUser(navUser) : null;
  const { createNew, creating } = useNewPlaylist();
  const cloud = useMyCloudGames({ enabled: !profileLoading });
  const reducedMotion = useReducedMotionSafe();

  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  /** The space the lists were read for; another space shows skeletons until its own arrive. */
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  const [matches, setMatches] = useState<Map<string, StoredMatch>>(new Map());
  const [teams, setTeams] = useState<Map<string, OrgTeam>>(new Map());
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const [sharing, setSharing] = useState<Playlist | null>(null);
  const nameDialog = useDialogState<FolderNameRequest>();
  const moveDialog = useDialogState<MoveRequest>();
  const deleteDialog = useDialogState<DeleteFolderRequest>();
  /** The open folder was deleted: show the folder it was in until the URL gets there. */
  const [leaving, setLeaving] = useState<{ from: string; to: string | null } | null>(null);

  // Players build nothing here: their playlists are the ones shared with them.
  useEffect(() => {
    if (editor === false) router.replace("/my-playlists");
  }, [editor, router]);

  useEffect(() => {
    if (profileLoading || !editor) return;
    const supabase = createClient();
    const orgId = activeOrgId ?? undefined;
    const scope = { includeUnscoped: activeOrgIsPersonal };
    let cancelled = false;
    void Promise.all([
      listPlaylists(supabase, orgId, scope),
      listFolders(supabase, orgId, scope).catch(() => [] as PlaylistFolder[]),
      listMatchesLight(supabase, orgId, { ownOnly: true, ...scope }).catch(() => [] as StoredMatch[]),
      !activeOrgIsPersonal && activeOrgId ? getOrgContextForOrg(activeOrgId, { myOrgs }).catch(() => null) : Promise.resolve(null),
    ]).then(([pls, fs, ms, ctx]) => {
      if (cancelled) return;
      setPlaylists(pls);
      setFolders(fs);
      setMatches(new Map(ms.map((m) => [m.id, m])));
      setTeams(new Map((ctx?.allOrgTeams ?? []).map((t) => [t.id, t])));
      setLoadedFor(activeOrgId);
    });
    return () => {
      cancelled = true;
    };
    // myOrgs is identical for every space; the space decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, editor, activeOrgId, activeOrgIsPersonal]);

  const loading = playlists === null || navUser === null || loadedFor !== activeOrgId;
  const ops = useFolderOps({ orgId: activeOrgId, folders, playlists, setFolders, setPlaylists });

  // ----- the tree ------------------------------------------------------------

  const realFolders = useMemo(() => folders.filter((f) => !isPendingFolder(f.id)), [folders]);
  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);
  const byParent = useMemo(() => childFoldersByParent(folders), [folders]);
  const parentOf = useMemo(() => shownParentMap(folders), [folders]);
  const descendants = useMemo(() => buildDescendantMap(realFolders), [realFolders]);
  const counts = useMemo(() => subtreePlaylistCounts(folders, playlists ?? []), [folders, playlists]);
  const paths = useMemo(() => folderPathNames(folders), [folders]);
  /** Folders with anything under them, the way the database's cascade sees it. */
  const withSubfolders = useMemo(() => new Set(folders.flatMap((f) => (f.parentId ? [f.parentId] : []))), [folders]);

  // ----- where we are --------------------------------------------------------

  const viewParam = leaving && leaving.from === folderParam ? leaving.to : folderParam;
  const currentFolderId = !loading && viewParam !== null && folderIds.has(viewParam) ? viewParam : null;
  const currentFolder = currentFolderId ? (folders.find((f) => f.id === currentFolderId) ?? null) : null;
  const trail = useMemo(() => (currentFolderId ? folderTrail(folders, currentFolderId) : []), [folders, currentFolderId]);

  // A folder the URL names that isn't here (another space's, deleted, a
  // stale link) sends the page to the nearest place that is.
  useEffect(() => {
    if (loading || folderParam === null || folderIds.has(folderParam)) return;
    goToFolder(leaving && leaving.from === folderParam ? leaving.to : null, { replace: true });
  }, [loading, folderParam, folderIds, leaving]);

  // Which way the last move between folders went: a folder's contents come
  // in from the right going down, from the left coming back up (iOS's push).
  const [shown, setShown] = useState<{ id: string | null; dir: -1 | 0 | 1 } | null>(null);
  if (!loading && (shown === null || shown.id !== currentFolderId)) {
    setShown({ id: currentFolderId, dir: shown === null ? 0 : folderNavDirection(folders, shown.id, currentFolderId) });
  }
  const pushDir = shown?.id === currentFolderId ? shown.dir : 0;

  // After moving between folders from the keyboard, the keys carry on in
  // the new list: the first row takes the focus the old row took with it.
  const contentRef = useRef<HTMLDivElement>(null);
  const firstView = useRef(true);
  useEffect(() => {
    if (loading) return;
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      contentRef.current?.querySelector<HTMLElement>('[role="button"]:not([aria-disabled="true"])')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentFolderId, loading]);

  const subfolders = useMemo(() => byParent.get(currentFolderId) ?? [], [byParent, currentFolderId]);
  const here = useMemo(
    () => (playlists ?? []).filter((p) => placedFolderId(folderIds, p.folderId) === currentFolderId),
    [playlists, folderIds, currentFolderId],
  );

  // ----- search, across every folder --------------------------------------------

  const words = useMemo(() => query.trim().toLocaleLowerCase("sv").split(/\s+/).filter(Boolean), [query]);
  const searching = words.length > 0;
  const pathLabel = useCallback((folderId: string | null) => (folderId ? (paths.get(folderId) ?? []).join(" / ") : ""), [paths]);
  const folderHits = useMemo(() => {
    if (!searching) return [];
    return flattenFolderTree(folders)
      .map((e) => e.folder)
      .filter((f) => {
        const hay = (paths.get(f.id) ?? [f.name]).join(" ").toLocaleLowerCase("sv");
        return words.every((w) => hay.includes(w));
      });
  }, [searching, folders, paths, words]);
  const playlistHits = useMemo(() => {
    if (!searching) return [];
    return (playlists ?? []).filter((p) => {
      const hay = `${p.name} ${pathLabel(placedFolderId(folderIds, p.folderId))}`.toLocaleLowerCase("sv");
      return words.every((w) => hay.includes(w));
    });
  }, [searching, playlists, folderIds, pathLabel, words]);

  // ----- moves -----------------------------------------------------------------

  /** Whether `item` may go into `target` (null: the top level): not where it is, never into itself. */
  const canMoveTo = useCallback(
    (item: { kind: "playlist" | "folder"; id: string }, target: string | null) => {
      if (target !== null && (!folderIds.has(target) || isPendingFolder(target))) return false;
      if (item.kind === "playlist") {
        const playlist = playlists?.find((p) => p.id === item.id);
        return !!playlist && placedFolderId(folderIds, playlist.folderId) !== target;
      }
      if (isPendingFolder(item.id) || target === item.id) return false;
      if ((parentOf.get(item.id) ?? null) === target) return false;
      return target === null || !(descendants.get(item.id)?.has(target) ?? false);
    },
    [folderIds, playlists, parentOf, descendants],
  );
  /** A folder has somewhere to go: anything but itself, what's in it and where it is. */
  const folderCanMove = (id: string) => realFolders.length - 1 - (descendants.get(id)?.size ?? 0) > 0;

  const dialogOpen =
    renaming !== null || deleting !== null || sharing !== null || nameDialog.open || moveDialog.open || deleteDialog.open;

  const drag = useFolderDrag({
    reducedMotion,
    // No lifting while a dialog or any menu is up (the toolbar's menus are not tracked in `menu`).
    canStart: (item) =>
      !dialogOpen && !document.querySelector('[role="menu"]') && !(item.kind === "folder" && isPendingFolder(item.id)),
    canDrop: canMoveTo,
    onDrop: (item, target) => {
      if (item.kind === "playlist") ops.movePlaylist(item.id, target, "drag");
      else ops.moveFolder(item.id, target, "drag");
    },
    onLongPress: (item) => setMenu(item.kind === "folder" ? folderMenuKey(item.id) : playlistMenuKey(item.id)),
  });

  // ----- actions -----------------------------------------------------------------

  function openFolder(id: string) {
    if (isPendingFolder(id)) return;
    setQuery("");
    setMenu(null);
    goToFolder(id);
  }

  function openPlaylist(id: string) {
    router.push(`/playlists/${encodeURIComponent(id)}`);
  }

  function deleteFolderNow(folder: PlaylistFolder, undoable: boolean) {
    // Deleting the open folder (from the toolbar) lands in the one it was in.
    if (currentFolderId && collectSubtreeIds(folders, folder.id).has(currentFolderId)) {
      setLeaving({ from: currentFolderId, to: parentOf.get(folder.id) ?? null });
    }
    ops.deleteFolder(folder.id, { undoable });
  }

  /** An empty folder goes at once (with Undo); one with anything in it asks first. */
  function requestDeleteFolder(folder: PlaylistFolder) {
    const stats = subtreeStats(folders, playlists ?? [], folder.id);
    if (stats.folderCount === 0 && stats.playlistCount === 0) deleteFolderNow(folder, true);
    else deleteDialog.show({ folder, stats });
  }

  const isEmptyFolder = (id: string) => (counts.get(id) ?? 0) === 0 && !withSubfolders.has(id);

  const newFolderIn = (parent: PlaylistFolder | null) => nameDialog.show({ mode: "create", parent });

  useKeyScope(KEY_SCOPE);
  useHotkeys(
    KEY_SCOPE,
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Keys typed in an open menu are its own (type to select).
      if (e.target instanceof Element && e.target.closest('[role="menu"]')) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        if (e.shiftKey) newFolderIn(currentFolder);
        else void createNew(currentFolderId);
      } else if (e.key === "/" && focusToolbarSearch()) {
        e.preventDefault();
      }
    },
    !dialogOpen && editor === true && !loading,
  );

  const teamNamesFor = useCallback(
    (playlist: Playlist) =>
      (playlist.teamIds ?? (playlist.teamId ? [playlist.teamId] : [])).map((id) => teams.get(id)?.name).filter((n): n is string => !!n),
    [teams],
  );

  const readiness = useMemo(
    () => (sharing ? shareReadiness(sharing, new Set(cloud.byMatch.keys()), matches) : undefined),
    [sharing, cloud.byMatch, matches],
  );

  function handleShared(playlist: Playlist, teamIds: string[], userIds: string[]) {
    setPlaylists((prev) => prev?.map((p) => (p.id === playlist.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p)) ?? prev);
    if (teamIds.length + userIds.length > 0 && (readiness?.prepare ?? 0) > 0) requestShipAfterShare(playlist.id);
  }

  // ----- rows ----------------------------------------------------------------------

  function folderMenu(folder: PlaylistFolder) {
    const key = folderMenuKey(folder.id);
    const empty = isEmptyFolder(folder.id);
    return (
      <RowMenu
        label={`More for ${folder.name}`}
        open={menu === key}
        onOpenChange={(open) => setMenu(open ? key : null)}
        disabled={isPendingFolder(folder.id)}
      >
        <DropdownMenuItem onSelect={() => void createNew(folder.id)}>
          <Plus />
          New playlist
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => newFolderIn(folder)}>
          <FolderPlus />
          New subfolder…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nameDialog.show({ mode: "rename", folder })}>
          <Pencil />
          Rename…
        </DropdownMenuItem>
        {folderCanMove(folder.id) && (
          <DropdownMenuItem onSelect={() => moveDialog.show({ kind: "folder", id: folder.id, name: folder.name })}>
            <FolderInput />
            Move to…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={DESTRUCTIVE_ITEM} onSelect={() => requestDeleteFolder(folder)}>
          <Trash2 />
          {empty ? "Delete" : "Delete…"}
        </DropdownMenuItem>
      </RowMenu>
    );
  }

  function playlistMenu(playlist: Playlist) {
    const key = playlistMenuKey(playlist.id);
    return (
      <RowMenu label={`More for ${playlist.name}`} open={menu === key} onOpenChange={(open) => setMenu(open ? key : null)}>
        <DropdownMenuItem onSelect={() => setRenaming(playlist)}>
          <Pencil />
          Rename…
        </DropdownMenuItem>
        {!activeOrgIsPersonal && (
          <DropdownMenuItem onSelect={() => setSharing(playlist)}>
            <Share2 />
            Share…
          </DropdownMenuItem>
        )}
        {realFolders.length > 0 && (
          <DropdownMenuItem
            onSelect={() => moveDialog.show({ kind: "playlist", id: playlist.id, name: playlist.name, folderId: playlist.folderId })}
          >
            <FolderInput />
            Move to…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={DESTRUCTIVE_ITEM} onSelect={() => setDeleting(playlist)}>
          <Trash2 />
          Delete…
        </DropdownMenuItem>
      </RowMenu>
    );
  }

  function folderItem(folder: PlaylistFolder, opts: { animated: boolean; description?: string | null }) {
    const pending = isPendingFolder(folder.id);
    const count = counts.get(folder.id) ?? 0;
    const item: FolderDragItem = { kind: "folder", id: folder.id, name: folder.name, detail: playlistCountLabel(count) };
    return (
      <BrowserItem
        key={ops.rowKey(folder.id)}
        dropFolder={pending ? undefined : folder.id}
        onPointerDown={(e) => drag.onItemPointerDown(e, item)}
        onOpenMenu={pending ? undefined : () => setMenu(folderMenuKey(folder.id))}
        reducedMotion={reducedMotion}
        animated={opts.animated}
      >
        <FolderRow
          folder={folder}
          count={count}
          description={opts.description}
          pending={pending}
          menu={folderMenu(folder)}
          onOpen={() => openFolder(folder.id)}
        />
      </BrowserItem>
    );
  }

  function playlistItem(playlist: Playlist, opts: { animated: boolean; folderLabel?: string | null }) {
    const item: FolderDragItem = { kind: "playlist", id: playlist.id, name: playlist.name, detail: clipsLabel(playlist) };
    return (
      <BrowserItem
        key={playlist.id}
        onPointerDown={(e) => drag.onItemPointerDown(e, item)}
        onOpenMenu={() => setMenu(playlistMenuKey(playlist.id))}
        reducedMotion={reducedMotion}
        animated={opts.animated}
      >
        <PlaylistRow
          playlist={playlist}
          folderLabel={opts.folderLabel}
          teamNames={teamNamesFor(playlist)}
          onOpen={() => openPlaylist(playlist.id)}
          trailing={playlistMenu(playlist)}
        />
      </BrowserItem>
    );
  }

  // ----- the page ------------------------------------------------------------------

  const total = playlists?.length ?? 0;
  const hasAnything = total > 0 || realFolders.length > 0;
  const shownCount = currentFolderId ? (counts.get(currentFolderId) ?? 0) : total;

  const newButtons = (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            className="rounded-r-none"
            onClick={() => void createNew(currentFolderId)}
            disabled={creating}
            aria-label="New playlist"
          >
            {creating ? <Loader2 className="animate-spin" /> : <Plus />}
            <span className="hidden sm:inline">New playlist</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-1.5 pointer-coarse:hidden">
          New playlist
          <Kbd>N</Kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" aria-label="New folder" className="rounded-l-none border-l border-primary-foreground/25 px-1.5 has-[>svg]:px-1.5">
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => newFolderIn(currentFolder)}>
            <FolderPlus />
            New folder…
            <DropdownMenuShortcut>
              <Kbd className="h-4 min-w-4 px-0.5 text-footnote">⇧N</Kbd>
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const folderActions = currentFolder && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`More for ${currentFolder.name}`} className="text-muted-foreground">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => nameDialog.show({ mode: "rename", folder: currentFolder })}>
          <Pencil />
          Rename folder…
        </DropdownMenuItem>
        {folderCanMove(currentFolder.id) && (
          <DropdownMenuItem onSelect={() => moveDialog.show({ kind: "folder", id: currentFolder.id, name: currentFolder.name })}>
            <FolderInput />
            Move folder to…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={DESTRUCTIVE_ITEM} onSelect={() => requestDeleteFolder(currentFolder)}>
          <Trash2 />
          {isEmptyFolder(currentFolder.id) ? "Delete folder" : "Delete folder…"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const newPlaylistAction = (
    <Button onClick={() => void createNew(currentFolderId)} disabled={creating}>
      {creating && <Loader2 className="animate-spin" />}
      New playlist
    </Button>
  );

  let content: React.ReactNode;
  if (loading || editor === false) {
    content = <SkeletonRows count={4} />;
  } else if (searching) {
    content =
      folderHits.length + playlistHits.length === 0 ? (
        <EmptyState
          icon={<ListVideo />}
          title="No playlists or folders match your search"
          body="Try a different name."
          action={
            <Button variant="outline" onClick={() => setQuery("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {folderHits.length > 0 && (
            <GroupedList role="group" aria-label="Folders">
              {folderHits.map((folder) => folderItem(folder, { animated: false, description: pathLabel(parentOf.get(folder.id) ?? null) || null }))}
            </GroupedList>
          )}
          {playlistHits.length > 0 && (
            <GroupedList role="group" aria-label="Playlists">
              {playlistHits.map((playlist) =>
                playlistItem(playlist, { animated: false, folderLabel: pathLabel(placedFolderId(folderIds, playlist.folderId)) || null }),
              )}
            </GroupedList>
          )}
        </div>
      );
  } else if (!hasAnything) {
    content = (
      <EmptyState icon={<ListVideo />} title="No playlists yet" body="Create a playlist and add clips from your games." action={newPlaylistAction} />
    );
  } else {
    content = (
      // Keyed by folder: another folder's list arrives whole, from the side it was entered from.
      <motion.div
        key={currentFolderId ?? "top"}
        ref={contentRef}
        initial={{ opacity: 0, x: pushDir * PUSH_PX }}
        animate={{ opacity: 1, x: 0 }}
        transition={springs.standard}
        className="space-y-6"
      >
        {subfolders.length > 0 && (
          <GroupedList role="group" aria-label="Folders">
            <AnimatePresence initial={false}>{subfolders.map((folder) => folderItem(folder, { animated: true }))}</AnimatePresence>
          </GroupedList>
        )}
        {here.length > 0 ? (
          <GroupedList role="group" aria-label="Playlists">
            <AnimatePresence initial={false}>{here.map((playlist) => playlistItem(playlist, { animated: true }))}</AnimatePresence>
          </GroupedList>
        ) : (
          subfolders.length === 0 && (
            <EmptyState
              icon={<Folder />}
              title="No playlists in this folder"
              body="Create one here, or move one in with Move to…"
              action={newPlaylistAction}
            />
          )
        )}
      </motion.div>
    );
  }

  return (
    <Page width="medium">
      <Toolbar
        title={currentFolder ? currentFolder.name : loading && viewParam ? BLANK_TITLE : TOP_LEVEL_NAME}
        subtitle={!loading && shownCount > 0 ? playlistCountLabel(shownCount) : undefined}
        leading={viewParam ? <FolderTrail trail={trail} /> : undefined}
        search={
          !loading && hasAnything ? (
            <ToolbarSearch
              placeholder="Search all playlists"
              aria-label="Search all playlists"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : undefined
        }
        actions={
          !loading ? (
            <>
              {newButtons}
              {folderActions}
            </>
          ) : undefined
        }
      />
      <PageContent>{content}</PageContent>

      {drag.card && <DragCardView card={drag.card} />}

      <RenamePlaylistDialog
        playlist={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(id, name) => setPlaylists((prev) => prev?.map((p) => (p.id === id ? { ...p, name } : p)) ?? prev)}
      />
      <DeletePlaylistDialog
        playlist={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => setPlaylists((prev) => prev?.filter((p) => p.id !== id) ?? prev)}
      />
      {!activeOrgIsPersonal && (
        <ShareDialog playlist={sharing} orgId={activeOrgId} onClose={() => setSharing(null)} onShared={handleShared} readiness={readiness} />
      )}
      <FolderNameDialog
        open={nameDialog.open}
        request={nameDialog.data}
        onClose={nameDialog.close}
        onSubmit={(request, name) => {
          if (request.mode === "create") ops.createFolder(name, request.parent?.id ?? null);
          else ops.renameFolder(request.folder.id, name);
        }}
      />
      <MoveToDialog
        open={moveDialog.open}
        request={moveDialog.data}
        folders={folders}
        onClose={moveDialog.close}
        onMove={(request, folderId) => {
          if (request.kind === "playlist") ops.movePlaylist(request.id, folderId, "menu");
          else ops.moveFolder(request.id, folderId, "menu");
        }}
      />
      <DeleteFolderDialog
        open={deleteDialog.open}
        request={deleteDialog.data}
        onClose={deleteDialog.close}
        onConfirm={(folder) => deleteFolderNow(folder, false)}
      />
    </Page>
  );
}
