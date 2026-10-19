"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ListVideo, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { isEditorUser } from "@scoutable/shared/lib/app-nav";
import { folderPath } from "@scoutable/shared/lib/folder-tree";
import { listFolders, listMatchesLight } from "@scoutable/shared/lib/matches-db";
import { listPlaylists } from "@scoutable/shared/lib/playlists-db";
import type { Playlist, PlaylistFolder, StoredMatch } from "@scoutable/shared/types/match";
import type { OrgTeam } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { DeletePlaylistDialog } from "@/components/playlist/delete-playlist-dialog";
import { PlaylistRow } from "@/components/playlist/playlist-row";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupedList } from "@/components/ui/group";
import { Kbd } from "@/components/ui/kbd";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMyCloudGames } from "@/lib/game-videos";
import { useHotkeys, useKeyScope } from "@/lib/key-scope";
import { getOrgContextForOrg } from "@/lib/profile-db";
import { createClient } from "@/lib/supabase/client";

const KEY_SCOPE = "playlists";

/**
 * The user's own playlists in the active space: name, clips, folder and
 * recipients per row, a menu to rename, share and delete, and the editor
 * one click away. "New playlist" creates one and opens it with its title
 * ready to rename. `N` is new, `/` is search.
 */
export default function PlaylistsPage() {
  const router = useRouter();
  const { activeOrgId, activeOrgIsPersonal, myOrgs, profileLoading } = useAuth();
  const navUser = useNavUser();
  const editor = navUser ? isEditorUser(navUser) : null;
  const { createNew, creating } = useNewPlaylist();
  const cloud = useMyCloudGames({ enabled: !profileLoading });

  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [folders, setFolders] = useState<PlaylistFolder[]>([]);
  const [matches, setMatches] = useState<Map<string, StoredMatch>>(new Map());
  const [teams, setTeams] = useState<Map<string, OrgTeam>>(new Map());
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const [sharing, setSharing] = useState<Playlist | null>(null);

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
    });
    return () => {
      cancelled = true;
    };
    // myOrgs is identical for every space; the space decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, editor, activeOrgId, activeOrgIsPersonal]);

  const dialogOpen = renaming !== null || deleting !== null || sharing !== null;
  useKeyScope(KEY_SCOPE);
  useHotkeys(
    KEY_SCOPE,
    (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void createNew();
      } else if (e.key === "/" && focusToolbarSearch()) {
        e.preventDefault();
      }
    },
    !dialogOpen && editor === true,
  );

  const folderLabelFor = useCallback(
    (playlist: Playlist) => (playlist.folderId ? folderPath(folders, playlist.folderId).join(" / ") || null : null),
    [folders],
  );
  const teamNamesFor = useCallback(
    (playlist: Playlist) => (playlist.teamIds ?? (playlist.teamId ? [playlist.teamId] : [])).map((id) => teams.get(id)?.name).filter((n): n is string => !!n),
    [teams],
  );

  const filtered = useMemo(() => {
    if (!playlists) return [];
    const words = query.trim().toLocaleLowerCase("sv").split(/\s+/).filter(Boolean);
    if (words.length === 0) return playlists;
    return playlists.filter((p) => {
      const hay = `${p.name} ${folderLabelFor(p) ?? ""}`.toLocaleLowerCase("sv");
      return words.every((w) => hay.includes(w));
    });
  }, [playlists, query, folderLabelFor]);

  const readiness = useMemo(
    () => (sharing ? shareReadiness(sharing, new Set(cloud.byMatch.keys()), matches) : undefined),
    [sharing, cloud.byMatch, matches],
  );

  function handleShared(playlist: Playlist, teamIds: string[], userIds: string[]) {
    setPlaylists((prev) => prev?.map((p) => (p.id === playlist.id ? { ...p, teamIds, teamId: teamIds[0], userIds } : p)) ?? prev);
    if (teamIds.length + userIds.length > 0 && (readiness?.prepare ?? 0) > 0) requestShipAfterShare(playlist.id);
  }

  const loading = playlists === null || navUser === null;
  const total = playlists?.length ?? 0;

  const newButton = (size: "sm" | "default" = "sm") => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={size} onClick={() => void createNew()} disabled={creating} aria-label="New playlist">
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          <span className={size === "sm" ? "hidden sm:inline" : undefined}>New playlist</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5 pointer-coarse:hidden">
        New playlist
        <Kbd>N</Kbd>
      </TooltipContent>
    </Tooltip>
  );

  return (
    <Page width="medium">
      <Toolbar
        title="Playlists"
        subtitle={!loading && total > 0 ? `${total} playlist${total === 1 ? "" : "s"}` : undefined}
        search={
          !loading && total > 0 ? (
            <ToolbarSearch placeholder="Search playlists" aria-label="Search playlists" value={query} onChange={(e) => setQuery(e.target.value)} />
          ) : undefined
        }
        actions={!loading && total > 0 ? newButton() : undefined}
      />
      <PageContent>
        {loading || editor === false ? (
          <SkeletonRows count={4} />
        ) : total === 0 ? (
          <EmptyState icon={<ListVideo />} title="No playlists yet" body="Create a playlist and add clips from your games." action={newButton("default")} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<ListVideo />}
            title="No playlists match your search"
            body="Try a different name."
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <GroupedList>
            {filtered.map((playlist) => (
              <PlaylistRow
                key={playlist.id}
                playlist={playlist}
                folderLabel={folderLabelFor(playlist)}
                teamNames={teamNamesFor(playlist)}
                onOpen={() => router.push(`/playlists/${encodeURIComponent(playlist.id)}`)}
                trailing={
                  // The menu's clicks (its trigger, and its items, which React
                  // bubbles through the portal) are not the row's.
                  <span onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`More for ${playlist.name}`} className="text-muted-foreground">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenaming(playlist)}>Rename…</DropdownMenuItem>
                        {!activeOrgIsPersonal && <DropdownMenuItem onSelect={() => setSharing(playlist)}>Share…</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive focus:text-white"
                          onSelect={() => setDeleting(playlist)}
                        >
                          Delete…
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                }
              />
            ))}
          </GroupedList>
        )}
      </PageContent>

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
    </Page>
  );
}
