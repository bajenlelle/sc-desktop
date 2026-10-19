"use client";

import * as React from "react";
import Link from "next/link";
import { ListVideo, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { itemKey, playlistMatchIds } from "@scoutable/shared/lib/playlist-edits";
import { isClipItem } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { ShareDialog } from "@/components/playlist/share-dialog";
import { shareReadiness } from "@/components/playlist/share-readiness";
import { useNewPlaylist } from "@/components/playlist/use-new-playlist";
import { BackButton } from "@/components/shell/back-button";
import { Page } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { StatusScreen } from "@/components/status-screen";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPACT_QUERY, useMediaQuery } from "@/components/ui/use-media-query";
import { AddClipsPanel } from "./add-clips-panel";
import { ClipList } from "./clip-list";
import { EditorActions } from "./editor-actions";
import { EditorLayout, EditorLayoutSwitch } from "./editor-layout";
import { EditorPlayer } from "./editor-player";
import { buildEditorRows } from "./editor-rows";
import { EditorSkeleton } from "./editor-skeleton";
import { EditorTitle } from "./editor-title";
import { NowPlaying } from "./now-playing";
import { useClipSelection } from "./use-clip-selection";
import { useEditorKeys } from "./use-editor-keys";
import { useEditorLayout } from "./use-editor-layout";
import { useEditorPlayback } from "./use-editor-playback";
import { itemKeysOf, usePlaylistEditor } from "./use-playlist-editor";

const BACK = <BackButton href="/playlists" label="Playlists" />;

/** "4 clips · 2 games" */
function subtitleFor(clips: number, games: number): string {
  const parts = [`${clips} ${clips === 1 ? "clip" : "clips"}`];
  if (games > 0) parts.push(`${games} ${games === 1 ? "game" : "games"}`);
  return parts.join(" · ");
}

/**
 * One of the user's playlists, open for editing: its clips played as
 * windows of their cloud copies, reordered, trimmed, noted, removed with
 * Undo, with text cards between them; plays added from a game's
 * play-by-play; the whole shared with teams and members, whose copies the
 * server cuts. Every edit lands at once and is put back with a toast if its
 * write fails (use-playlist-editor.ts). The keys are the desktop's.
 */
export function PlaylistEditor({ playlistId }: { playlistId: string }) {
  const editor = usePlaylistEditor(playlistId);
  const { activeOrgId, activeOrgIsPersonal } = useAuth();
  const { createNew } = useNewPlaylist();
  const [layout, setLayout] = useEditorLayout();
  const [wide, setWide] = React.useState(false);
  const compact = useMediaQuery(COMPACT_QUERY);

  const { playlist, status, isOwner, matches, eventsLoaded, eventByKey, cloud, rolls } = editor;
  const playback = useEditorPlayback({ playlist, eventByKey, cloud, rolls, onCommitOffsets: editor.commitClipOffsets });
  const order = React.useMemo(() => itemKeysOf(playlist), [playlist]);
  const selection = useClipSelection(order);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [menuKey, setMenuKey] = React.useState<string | null>(null);
  // What the URL asked for on arrival (a playlist just created wants its
  // name typed; a game page sent its game to be picked from).
  const [titleEditing, setTitleEditing] = React.useState(() => editor.intents.rename);
  const [panel, setPanel] = React.useState<{ open: boolean; anchor: DOMRect | null; matchId: string | null }>(() => ({
    open: editor.intents.addMatchId !== null,
    anchor: null,
    matchId: editor.intents.addMatchId,
  }));
  const [sharing, setSharing] = React.useState(false);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [autoFocusCardId, setAutoFocusCardId] = React.useState<string | null>(null);

  const rows = React.useMemo(
    () => (playlist ? buildEditorRows({ playlist, eventByKey, watchItems: playback.items, cloud, matches, eventsLoaded }) : []),
    [playlist, eventByKey, playback.items, cloud, matches, eventsLoaded],
  );
  const groupIdOf = React.useMemo(() => {
    const map = new Map<string, string>();
    if (playlist) for (const item of playlist.items) if (item.groupId) map.set(itemKey(item), item.groupId);
    return map;
  }, [playlist]);
  const isMultiMatch = playlist ? playlistMatchIds(playlist).length > 1 : false;
  const clipCount = playlist ? playlist.items.filter(isClipItem).length : 0;

  // Whatever starts playing becomes the row the keys work from.
  const { focusOn } = selection;
  const activeKey = playback.activeKey;
  React.useEffect(() => {
    if (activeKey) focusOn(activeKey);
  }, [activeKey, focusOn]);

  // ---------------------------------------------------------------------------
  // Actions over the list
  // ---------------------------------------------------------------------------

  const { afterRemoval } = selection;
  const { removeItems, insertCard: editorInsertCard } = editor;
  const removeKeys = React.useCallback(
    (keys: ReadonlySet<string>) => {
      if (keys.size === 0) return;
      // The stage lets go of a clip that leaves (a trim on it ends first).
      if (playback.trim && keys.has(playback.trim.key)) playback.endTrim(null);
      if (playback.q.activeKey && keys.has(playback.q.activeKey)) playback.q.stop();
      afterRemoval(keys);
      removeItems(keys);
    },
    [playback, afterRemoval, removeItems],
  );

  const insertCard = React.useCallback(
    async (beforeKey: string | null, entry: "menu" | "row") => {
      const id = await editorInsertCard(beforeKey, entry);
      if (!id) return;
      setAutoFocusCardId(id);
      focusOn(`text:${id}`);
    },
    [editorInsertCard, focusOn],
  );

  /** The toolbar's Add text card: above the first ticked row, else at the end. */
  const addTextCard = React.useCallback(() => {
    const first = order.find((k) => selection.selected.has(k)) ?? null;
    void insertCard(first, "menu");
  }, [order, selection.selected, insertCard]);

  const onTrimRefused = React.useCallback(() => {
    toast("This clip can't be trimmed here", {
      description: "Clips are trimmed on your cloud copy of the game. Upload the game's video in the Library.",
    });
  }, []);

  const trimRow = React.useCallback(
    (key: string) => {
      if (!playback.startTrim(key)) onTrimRefused();
    },
    [playback, onTrimRefused],
  );

  const playAll = React.useCallback(() => {
    const first = playback.items[0];
    if (first) playback.playRow(first.key);
  }, [playback]);

  const openPanel = React.useCallback((anchor: DOMRect | null = null) => setPanel({ open: true, anchor, matchId: null }), []);
  const closePanel = React.useCallback(() => setPanel((p) => ({ ...p, open: false })), []);

  useEditorKeys({
    enabled: status === "ready" && isOwner,
    order,
    groupIdOf,
    selection,
    playback,
    editor,
    gridRef,
    openRowMenu: setMenuKey,
    removeKeys,
    onNewPlaylist: () => void createNew(),
    onTrimRefused,
  });

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (status === "loading" || !playlist) {
    if (status === "missing") {
      return (
        <Page width="full">
          <Toolbar inline leading={BACK} title="Playlist" />
          <StatusScreen
            icon={<ListVideo />}
            title="This playlist isn't available"
            body="It may have been deleted, or it belongs to someone else."
            actions={
              <Button asChild>
                <Link href="/playlists">Back to Playlists</Link>
              </Button>
            }
          />
        </Page>
      );
    }
    return (
      <Page width="full">
        <Toolbar inline leading={BACK} title={<Skeleton className="h-4 w-32" />} />
        <EditorSkeleton />
      </Page>
    );
  }

  if (!isOwner) {
    return (
      <Page width="full">
        <Toolbar inline leading={BACK} title={playlist.name} />
        <StatusScreen
          icon={<LockKeyhole />}
          title="This playlist isn't yours to edit"
          body="Only the coach who made it can change it. You can watch it in My playlists."
          actions={
            <Button asChild>
              <Link href={`/my-playlists?p=${encodeURIComponent(playlist.id)}`}>Open in My playlists</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  const activeClip = playback.activePlay ? (playlist.items.find((i) => isClipItem(i) && itemKey(i) === playback.activePlay!.key) ?? null) : null;
  const hasOffsets = !!activeClip && isClipItem(activeClip) && ((activeClip.preRollOffset ?? 0) !== 0 || (activeClip.postRollOffset ?? 0) !== 0);
  const sharedTeams = playlist.teamIds?.length ?? (playlist.teamId ? 1 : 0);
  const sharedPeople = playlist.userIds?.length ?? 0;

  // One title, mounted where it fits: in the bar, or on a phone, whose bar the
  // actions fill, as a line of its own that scrolls away above the player.
  const title = (
    <EditorTitle name={playlist.name} editing={titleEditing} onEditingChange={setTitleEditing} onRename={(name) => void editor.rename(name)} />
  );

  return (
    <Page width="full">
      <Toolbar
        inline
        leading={BACK}
        title={compact ? null : title}
        subtitle={subtitleFor(clipCount, playlistMatchIds(playlist).length)}
        actions={
          <EditorActions
            rolls={rolls}
            onRolls={editor.setRolls}
            onAddClips={openPanel}
            onAddTextCard={addTextCard}
            canShare={!activeOrgIsPersonal}
            sharedTeams={sharedTeams}
            sharedPeople={sharedPeople}
            onShare={() => setSharing(true)}
            ship={editor.ship}
            onSelectAll={selection.selectAll}
            onRename={() => setTitleEditing(true)}
            onDelete={() => setConfirmingDelete(true)}
          />
        }
      />

      {compact && (
        <div className="px-4 pt-1 pb-3">
          <h1 className="truncate text-title-2 font-bold text-foreground">{title}</h1>
        </div>
      )}

      <EditorLayout
        layout={layout}
        fullscreenLayer={playback.fullscreen.layer}
        onWideChange={setWide}
        player={<EditorPlayer playback={playback} title={playlist.name} playableCount={playback.items.length} onPlayAll={playAll} className="@min-[860px]/editor:rounded-lg" />}
        nowPlaying={
          <NowPlaying
            item={playback.activeItem}
            matchTitle={isMultiMatch && playback.activePlay ? matches.get(playback.activePlay.matchId)?.title : undefined}
            window={playback.activePlay ? playback.windowFor(playback.activePlay.key) : null}
            hasOffsets={hasOffsets}
            canTrim={playback.activeWindow !== null}
            trimming={playback.trim !== null}
            readOnly={false}
            onTrim={() => trimRow(playback.activeKey ?? "")}
            onReset={() => playback.activeKey && playback.resetTrim(playback.activeKey)}
            onNote={editor.setNote}
          />
        }
        listHeader={
          <div className="flex items-center gap-3 px-4 pt-4 pb-2 sm:px-6 @min-[860px]/editor:px-3 @min-[860px]/editor:pt-0">
            <span className="text-headline">Clips</span>
            {/* The bar carries the count beside the sidebar; here it is for the phone's bar, which doesn't. */}
            <span className="text-subheadline text-muted-foreground nums lg:hidden">{subtitleFor(clipCount, playlistMatchIds(playlist).length)}</span>
            {wide && <EditorLayoutSwitch layout={layout} onChange={setLayout} className="ml-auto" />}
          </div>
        }
        list={
          <div className="sm:px-2 @min-[860px]/editor:px-0">
            <ClipList
              rows={rows}
              playlist={playlist}
              isOwner={isOwner}
              isMultiMatch={isMultiMatch}
              activeKey={playback.activeKey}
              selection={selection}
              menuKey={menuKey}
              onMenuKeyChange={setMenuKey}
              onPlayRow={(key) => playback.playRow(key, { holdCard: true })}
              onTrim={trimRow}
              onInsertCardAbove={(key) => void insertCard(key, "row")}
              onRemove={removeKeys}
              onReorder={editor.reorder}
              onCardText={(id, text) => void editor.updateCard(id, { text })}
              onCardDuration={(id, durationSeconds) => void editor.updateCard(id, { durationSeconds })}
              autoFocusCardId={autoFocusCardId}
              gridRef={gridRef}
              onAddClips={() => openPanel()}
            />
          </div>
        }
      />

      <AddClipsPanel
        open={panel.open}
        anchor={panel.anchor}
        onClose={closePanel}
        source={{
          playlist,
          matches,
          cloud,
          eventsLoaded,
          ensureEventsFor: editor.ensureEventsFor,
          initialMatchId: panel.matchId,
          onAdd: editor.addClips,
        }}
      />

      <ShareDialog
        playlist={sharing ? playlist : null}
        orgId={playlist.orgId ?? activeOrgId}
        onClose={() => setSharing(false)}
        onShared={editor.onShared}
        readiness={sharing ? shareReadiness(playlist, cloud.readyMatchIds, matches) : undefined}
      />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${playlist.name}”?`}
        description={`${
          clipCount === 0 ? "It has no clips yet." : clipCount === 1 ? "Its clip is removed from the playlist." : `Its ${clipCount} clips are removed from the playlist.`
        } The games stay in your Library.${sharedTeams + sharedPeople > 0 ? " The people it is shared with lose access." : ""} This can’t be undone.`}
        confirmLabel="Delete playlist"
        destructive
        busy={editor.deleting}
        onConfirm={editor.deletePlaylist}
      />
    </Page>
  );
}
