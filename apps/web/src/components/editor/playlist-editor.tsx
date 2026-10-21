"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ListVideo, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import type { ExportAspect, ExportPurpose } from "@scoutable/shared/lib/game-video-wire";
import { itemKey, playlistMatchIds } from "@scoutable/shared/lib/playlist-edits";
import type { ClipKey } from "@scoutable/shared/types/labels";
import { isClipItem } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { playlistsHref, TOP_LEVEL_NAME } from "@/components/folders/folder-nav";
import { LabelDeleteDialog } from "@/components/labels/label-delete-dialog";
import { clipKeyOf, useLabelAssignments, useLabels } from "@/components/labels/use-labels";
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
import { UpgradeDialog } from "@/components/upgrade-dialog";
import { AddClipsPanel } from "./add-clips-panel";
import { ClipList, type EditorLabels, type EditorStatsEntries } from "./clip-list";
import { EditorActions } from "./editor-actions";
import { EditorLayout, EditorLayoutSwitch } from "./editor-layout";
import { EditorPlayer } from "./editor-player";
import { buildEditorRows } from "./editor-rows";
import { EditorSkeleton } from "./editor-skeleton";
import { EditorTitle } from "./editor-title";
import type { ExportDialogCounts, ExportDialogRequest } from "./export-dialog";
import { NowPlaying } from "./now-playing";
import { StatsCardSuggestion } from "./stats-card-suggestion";
import { useAddTo } from "./use-add-to";
import { useClipSelection } from "./use-clip-selection";
import { useEditorKeys } from "./use-editor-keys";
import { useEditorLayout } from "./use-editor-layout";
import { useEditorPlayback } from "./use-editor-playback";
import { exportContentFor, useExport } from "./use-export";
import { itemKeysOf, usePlaylistEditor } from "./use-playlist-editor";
import { useStatsCards } from "./use-stats-cards";

// Loaded when first needed, off the editor's first render: the inspector and
// the sync sheet open on demand; the export dialog and the phone sheet carry
// the card painter and the QR code.
const StatsCardInspector = dynamic(() => import("@/components/stats-card/stats-card-inspector").then((m) => m.StatsCardInspector));
const FixSyncSheet = dynamic(() => import("@/components/sync/fix-sync-sheet").then((m) => m.FixSyncSheet));
const ExportDialog = dynamic(() => import("./export-dialog").then((m) => m.ExportDialog));
const SendToPhoneSheet = dynamic(() => import("./send-to-phone-sheet").then((m) => m.SendToPhoneSheet));

const hundredths = (n: number) => Math.round(n * 100) / 100;

/** "4 clips · 2 games" */
function subtitleFor(clips: number, games: number): string {
  const parts = [`${clips} ${clips === 1 ? "clip" : "clips"}`];
  if (games > 0) parts.push(`${games} ${games === 1 ? "game" : "games"}`);
  return parts.join(" · ");
}

/**
 * One of the user's playlists, open for editing: its clips played as
 * windows of their cloud copies, reordered (groups move whole), trimmed,
 * noted, labelled, removed with Undo, copied to another playlist, with text
 * and stats cards between them; plays added from a game's play-by-play; the
 * whole shared with teams and members, whose copies the server cuts. Every
 * edit lands at once and is put back with a toast if its write fails
 * (use-playlist-editor.ts). The keys are the desktop's. Back leads to the
 * folder the playlist is in.
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
  const ready = status === "ready" && isOwner;

  // Exports: the format dialog, then the server's render, followed by the pill.
  const exporter = useExport({ playlist, eventByKey, cloud, enabled: ready });
  const [exportRequest, setExportRequest] = React.useState<ExportDialogRequest | null>(null);
  /**
   * The dialog for a download or a link, of the ticked rows when there are
   * any (the desktop's export honours the selection too). Every row ticked
   * is the playlist itself, which may reuse its link.
   */
  const openExport = React.useCallback(
    (purpose: ExportPurpose) => {
      const picked = order.filter((k) => selection.selected.has(k));
      setExportRequest({ open: true, purpose, selection: picked.length > 0 && picked.length < order.length ? picked : null });
    },
    [order, selection.selected],
  );
  // Home's export nudge arrives with ?export=: the dialog opens by itself,
  // once, as soon as the copies are known (the content key reads them).
  const [exportIntentHandled, setExportIntentHandled] = React.useState(false);
  const intentPurpose = editor.intents.exportPurpose;
  const dialogRequest: ExportDialogRequest | null =
    exportRequest ??
    (intentPurpose && !exportIntentHandled && exporter.ready && !exporter.busy ? { open: true, purpose: intentPurpose, selection: null } : null);
  const closeExport = () => {
    setExportIntentHandled(true);
    // Kept, closed, so the dialog's words stay put on the way out.
    setExportRequest(dialogRequest ? { ...dialogRequest, open: false } : null);
  };
  const { start: startExport } = exporter;
  const pickExport = (aspect: ExportAspect, watermark: boolean) => {
    if (!dialogRequest) return;
    setExportIntentHandled(true);
    setExportRequest({ ...dialogRequest, open: false });
    void startExport({ purpose: dialogRequest.purpose, aspect, watermark, selection: dialogRequest.selection });
  };
  const dialogShown = dialogRequest !== null;
  const dialogSelection = dialogRequest?.selection ?? null;
  const exportCounts = React.useMemo<ExportDialogCounts>(() => {
    if (!dialogShown || !playlist) return { clips: 0, pannedClips: 0, selectedClips: 0, selectedCards: 0 };
    const vertical = exportContentFor({ playlist, eventByKey, cloud, aspect: "9:16", selection: dialogSelection });
    return {
      clips: vertical.clips,
      pannedClips: vertical.pannedClips,
      selectedClips: dialogSelection ? dialogSelection.filter((k) => !k.startsWith("text:")).length : 0,
      selectedCards: dialogSelection ? dialogSelection.filter((k) => k.startsWith("text:")).length : 0,
    };
  }, [dialogShown, dialogSelection, playlist, eventByKey, cloud]);

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
  // Labels: the space's vocabulary, the clips' labels in this playlist
  // ---------------------------------------------------------------------------

  const labelOrgId = playlist?.orgId ?? activeOrgId;
  const clipKeys = React.useMemo<ClipKey[]>(
    () => (playlist ? playlist.items.filter(isClipItem).map((c) => ({ matchId: c.matchId, eventId: c.eventId })) : []),
    [playlist],
  );
  const {
    byClip: labelsByClip,
    toggle: toggleLabel,
    forget: forgetLabel,
  } = useLabelAssignments({ orgId: labelOrgId, scope: playlist?.id ?? null, clips: clipKeys, enabled: ready && !!playlist });
  const vocab = useLabels(ready ? labelOrgId : null, { onDeleted: forgetLabel });
  const playlistName = playlist?.name ?? "";
  const labelCtl = React.useMemo<EditorLabels | undefined>(
    () =>
      ready && labelOrgId
        ? {
            labels: vocab.labels,
            byClip: labelsByClip,
            toggle: (keys, labelId, state, bulk) =>
              toggleLabel(
                keys.map(clipKeyOf).filter((k): k is ClipKey => k !== null),
                labelId,
                state,
                bulk,
              ),
            actions: vocab.actions,
            scopeTitle: `Labels in ${playlistName}`,
            scopeHint: "Visible only in this playlist",
          }
        : undefined,
    [ready, labelOrgId, vocab.labels, vocab.actions, labelsByClip, toggleLabel, playlistName],
  );

  // ---------------------------------------------------------------------------
  // Add to another playlist; stats cards
  // ---------------------------------------------------------------------------

  const addTo = useAddTo({ playlist, folders: editor.folders });

  const { insertCard: editorInsertCard, updateCard: editorUpdateCard } = editor;
  const statsCards = useStatsCards({
    playlist,
    matches,
    eventByKey,
    eventsLoaded,
    activeKey,
    personal: activeOrgIsPersonal,
    enabled: ready,
    insertCard: editorInsertCard,
    updateCard: editorUpdateCard,
    onInserted: (cardId) => {
      // The new card, held on the stage, as the desktop shows it.
      const key = `text:${cardId}`;
      focusOn(key);
      playback.playRow(key, { holdCard: true });
    },
  });
  const { openNew: openNewStatsCard, openEdit: openEditStatsCard } = statsCards;
  const statsEntries = React.useMemo<EditorStatsEntries>(
    () => ({
      canStartFrom: statsCards.canStartFrom,
      available: statsCards.disabledReason === null,
      onInsertAbove: (key, fromClip) => openNewStatsCard({ beforeKey: key, entry: "row", anchorKey: fromClip ? key : null }),
      onEdit: (cardId) => void openEditStatsCard(cardId),
    }),
    [statsCards.canStartFrom, statsCards.disabledReason, openNewStatsCard, openEditStatsCard],
  );
  /** The toolbar's Add stats card: above the first ticked row, else at the end, as the text card goes. */
  const addStatsCard = React.useCallback(() => {
    openNewStatsCard({ beforeKey: order.find((k) => selection.selected.has(k)) ?? null, entry: "menu" });
  }, [openNewStatsCard, order, selection.selected]);
  /** Return on a focused stats card opens it rather than playing it. */
  const editRow = React.useCallback(
    (key: string) => {
      const card = playlist?.items.find((i) => !isClipItem(i) && itemKey(i) === key);
      if (!card || isClipItem(card) || !card.card) return false;
      void openEditStatsCard(card.id);
      return true;
    },
    [playlist, openEditStatsCard],
  );

  // ---------------------------------------------------------------------------
  // Fix sync: from a clip's menu or the playing clip, for a game the viewer
  // has a ready cloud copy of (only its uploader may move its sync). The
  // sheet writes the sync itself; the windows follow it here at once.
  // ---------------------------------------------------------------------------

  const [syncFix, setSyncFix] = React.useState<{ open: boolean; key: string; matchId: string; eventId: number; entry: "clip_menu" | "this_clip" } | null>(null);
  const clipOf = React.useCallback(
    (key: string) => {
      const item = playlist?.items.find((i) => isClipItem(i) && itemKey(i) === key);
      return item && isClipItem(item) ? item : null;
    },
    [playlist],
  );
  const canFixSync = React.useCallback(
    (matchId: string) => cloud.videoByMatch.get(matchId)?.status === "ready" && cloud.syncByMatch.has(matchId) && eventsLoaded.has(matchId),
    [cloud, eventsLoaded],
  );
  const { trim: activeTrim, endTrim, videoRef: stageVideoRef } = playback;
  const openSyncFix = React.useCallback(
    (key: string, entry: "clip_menu" | "this_clip") => {
      const clip = clipOf(key);
      if (!clip) return;
      if (activeTrim) endTrim(null);
      stageVideoRef.current?.pause();
      setSyncFix({ open: true, key, matchId: clip.matchId, eventId: clip.eventId, entry });
    },
    [clipOf, activeTrim, endTrim, stageVideoRef, setSyncFix],
  );
  const fixSyncFor = React.useCallback(
    (key: string) => {
      const clip = clipOf(key);
      return clip && canFixSync(clip.matchId) ? () => openSyncFix(key, "clip_menu") : undefined;
    },
    [clipOf, canFixSync, openSyncFix],
  );
  const { commitClipOffsets, applySync } = editor;
  /** "Just this clip": its window moves by Δ (offsets pre − Δ, post + Δ); a failed save keeps the sheet open. */
  const nudgeSyncFixClip = React.useCallback(
    async (delta: number) => {
      const key = syncFix?.key;
      const clip = key ? clipOf(key) : null;
      if (!key || !clip) throw new Error("The clip is gone");
      const saved = await commitClipOffsets(key, hundredths((clip.preRollOffset ?? 0) - delta), hundredths((clip.postRollOffset ?? 0) + delta), { quiet: true });
      if (!saved) throw new Error("The clip's length wasn't saved");
    },
    [syncFix?.key, clipOf, commitClipOffsets],
  );

  // ---------------------------------------------------------------------------
  // Actions over the list
  // ---------------------------------------------------------------------------

  const { afterRemoval } = selection;
  const { removeItems } = editor;
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
    enabled: ready,
    order,
    groupIdOf,
    selection,
    playback,
    editor,
    gridRef,
    openRowMenu: setMenuKey,
    removeKeys,
    // A new playlist goes in this one's folder.
    onNewPlaylist: () => void createNew(editor.folderId),
    onTrimRefused,
    onEditRow: editRow,
  });

  // Back to where the playlist is listed: its folder, or the top level.
  const back = <BackButton href={playlistsHref(editor.folderId)} label={editor.folder?.name ?? TOP_LEVEL_NAME} />;

  // ---------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------

  if (status === "loading" || !playlist) {
    if (status === "missing") {
      return (
        <Page width="full">
          <Toolbar inline leading={back} title="Playlist" />
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
        <Toolbar inline leading={back} title={<Skeleton className="h-4 w-32" />} />
        <EditorSkeleton />
      </Page>
    );
  }

  if (!isOwner) {
    return (
      <Page width="full">
        <Toolbar inline leading={back} title={playlist.name} />
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
  const inspector = statsCards.inspector;

  // One title, mounted where it fits: in the bar, or on a phone, whose bar the
  // actions fill, as a line of its own that scrolls away above the player.
  const title = (
    <EditorTitle name={playlist.name} editing={titleEditing} onEditingChange={setTitleEditing} onRename={(name) => void editor.rename(name)} />
  );

  return (
    <Page width="full">
      <Toolbar
        inline
        leading={back}
        title={compact ? null : title}
        subtitle={subtitleFor(clipCount, playlistMatchIds(playlist).length)}
        actions={
          <EditorActions
            rolls={rolls}
            onRolls={editor.setRolls}
            onAddClips={openPanel}
            onAddTextCard={addTextCard}
            onAddStatsCard={addStatsCard}
            statsCardDisabledReason={statsCards.disabledReason}
            canShare={!activeOrgIsPersonal}
            sharedTeams={sharedTeams}
            sharedPeople={sharedPeople}
            onShare={() => setSharing(true)}
            ship={editor.ship}
            exporter={exporter}
            onExport={openExport}
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
            onEditCard={(cardId) => void openEditStatsCard(cardId)}
            onFixSync={
              playback.activeWindow && canFixSync(playback.activeWindow.matchId) ? () => openSyncFix(playback.activeWindow!.key, "this_clip") : undefined
            }
          />
        }
        listHeader={
          <>
            <div className="flex items-center gap-3 px-4 pt-4 pb-2 sm:px-6 @min-[860px]/editor:px-3 @min-[860px]/editor:pt-0">
              <span className="text-headline">Clips</span>
              {/* The bar carries the count beside the sidebar; here it is for the phone's bar, which doesn't. */}
              <span className="text-subheadline text-muted-foreground nums lg:hidden">{subtitleFor(clipCount, playlistMatchIds(playlist).length)}</span>
              {wide && <EditorLayoutSwitch layout={layout} onChange={setLayout} className="ml-auto" />}
            </div>
            <StatsCardSuggestion suggestion={statsCards.suggestion} className="px-4 pb-2 sm:px-6 @min-[860px]/editor:px-0" />
          </>
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
              onFixSync={fixSyncFor}
              onInsertCardAbove={(key) => void insertCard(key, "row")}
              onRemove={removeKeys}
              onReorder={editor.reorder}
              onGroup={editor.group}
              onUngroup={editor.ungroup}
              onCardText={(id, text) => void editor.updateCard(id, { text })}
              onCardDuration={(id, durationSeconds) => void editor.updateCard(id, { durationSeconds })}
              autoFocusCardId={autoFocusCardId}
              gridRef={gridRef}
              onAddClips={() => openPanel()}
              exporter={exporter}
              onExport={openExport}
              labels={labelCtl}
              addTo={addTo}
              stats={statsEntries}
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
          labels: vocab.labels,
          labelOrgId,
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

      <LabelDeleteDialog labels={vocab} />

      {syncFix && matches.get(syncFix.matchId) && cloud.videoByMatch.get(syncFix.matchId) && (
        <FixSyncSheet
          open={syncFix.open}
          onClose={() => setSyncFix((f) => (f ? { ...f, open: false } : f))}
          match={matches.get(syncFix.matchId)!}
          events={matches.get(syncFix.matchId)!.events}
          clip={{ matchId: syncFix.matchId, eventId: syncFix.eventId }}
          videoId={cloud.videoByMatch.get(syncFix.matchId)!.id}
          // The clip again from its new place, once its window has followed the fix.
          play={() => {
            const key = syncFix.key;
            requestAnimationFrame(() => playback.playRow(key));
          }}
          onApplied={(next) => applySync(syncFix.matchId, next)}
          onClipNudge={nudgeSyncFixClip}
          entry={syncFix.entry}
        />
      )}

      {inspector && (
        <StatsCardInspector
          key={inspector.id}
          open={inspector.open}
          onClose={statsCards.closeInspector}
          match={inspector.match}
          events={inspector.events}
          leagues={statsCards.leagues}
          initial={inspector.target.kind === "edit" ? inspector.target.spec : undefined}
          onSave={(spec, text) => void statsCards.saveInspector(spec, text)}
          games={inspector.games}
          defaultScope={inspector.defaultScope}
        />
      )}

      <ExportDialog request={dialogRequest} plan={exporter.plan} counts={exportCounts} onClose={closeExport} onPick={pickExport} />

      <SendToPhoneSheet
        open={exporter.sheetOpen}
        link={exporter.share}
        working={exporter.activity?.purpose === "share" ? exporter.activity : null}
        onClose={exporter.closeSheet}
        onCreateNew={exporter.createNewLink}
        onCancel={() => void exporter.cancel()}
        onCopied={exporter.linkCopied}
      />

      <UpgradeDialog
        open={!!exporter.upgrade?.open}
        onClose={exporter.closeUpgrade}
        title={exporter.upgrade?.purpose === "share" ? "Send your playlist to your phone" : "Download your playlist as a video"}
        feature={`${exporter.upgrade?.purpose === "share" ? "send_to_phone" : "export_playlist"}${exporter.upgrade?.aspect === "9:16" ? "_vertical" : ""}`}
        source="editor_export"
      />
    </Page>
  );
}
