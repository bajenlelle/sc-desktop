"use client";

/**
 * The editor's exports: one MP4 of the playlist, or of the rows ticked in
 * it, rendered on the server from the owner's cloud copies (a render job of
 * kind `export`) and delivered the desktop's two ways. Download saves the
 * file through a link that names it; Send to my phone makes a highlight
 * link `/h/<id>` and shows it with a QR code. A link is found again instead
 * of rendered when the same content was linked before (the desktop's content
 * key, worked out here by export-content-key.ts), unless a new one is asked for.
 *
 * One export at a time per playlist. It is read every 2 s while the tab is
 * visible, its progress spoken as "Exporting · clip 3 of 8", "Joining…",
 * "Uploading…", and it can be cancelled; a reload in the middle picks the
 * live job up again. A free plan gets the upgrade path before anything is
 * asked of the server, which says the same with `upgrade_required`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { exportContentKey, type ExportContent } from "@scoutable/shared/lib/export-content-key";
import { cancelRender, exportDownloadLink, exportPlaylist } from "@scoutable/shared/lib/game-video-client";
import {
  EXPORT_KEEP_DAYS,
  SHARE_LINK_DAYS,
  type ExportAspect,
  type ExportDropped,
  type ExportJobResult,
  type ExportPurpose,
  type RenderPhase,
  type ShipNoCopy,
} from "@scoutable/shared/lib/game-video-wire";
import { itemKey } from "@scoutable/shared/lib/playlist-edits";
import { getLiveRenderJob, getRenderJob, isRenderJobLive, type RenderJob } from "@scoutable/shared/lib/render-jobs-db";
import { isClipItem, type PlayByPlayEvent, type Playlist } from "@scoutable/shared/types/match";
import type { OrgMembership, OrgPlanTier } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { trackEvent } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import type { EditorCloud } from "./use-playlist-editor";

const POLL_MS = 2000;
/** Reads in a row that find nothing (a dropped connection, say) before the job is let go: five minutes. */
const MAX_MISSES = 150;
const DAY_MS = 86_400_000;

/** What the dialog asks for. */
export interface ExportOptions {
  purpose: ExportPurpose;
  aspect: ExportAspect;
  /** Downloads: whether the Scoutable mark is drawn (always on for Rookie). Links always carry it. */
  watermark: boolean;
  /** Item keys in playlist order; null exports the whole playlist. */
  selection: string[] | null;
  /** Links: make a new one even when this content already has one. */
  fresh?: boolean;
}

/** Clips the server left out of an export, by reason. */
export interface LeftOut {
  /** Their game has no cloud copy the owner may use. */
  noCopy: number;
  /** They start after their copy ends. */
  pastEnd: number;
  /** The sync can't place their play. */
  noTime: number;
}

const NOTHING_LEFT_OUT: LeftOut = { noCopy: 0, pastEnd: 0, noTime: 0 };

/** A finished link, as the send-to-phone sheet shows it. */
export interface ShareLink {
  shareId: string;
  url: string;
  aspect: ExportAspect;
  /** An unexpired link of the same content came back instead of a render. */
  reused: boolean;
  /** Whole days since a reused link was made; null for a new one. */
  madeDaysAgo: number | null;
  /** Whole days the link still works; null when the server didn't say. */
  daysLeft: number | null;
  selection: string[] | null;
  leftOut: LeftOut;
}

type ActivePhase = "requesting" | "queued" | "running" | "cancelling";

interface ActiveExport {
  playlistId: string;
  /** Null while the request is on its way. */
  jobId: string | null;
  phase: ActivePhase;
  options: ExportOptions;
  /** Segments the render makes (clips and cards); 0 when not known (a job picked up after a reload). */
  segments: number;
  clips: number;
  cards: number;
  /** 0..1 over the segments and the join, as the renderer reports it. */
  progress: number;
  renderPhase: RenderPhase | null;
  leftOut: LeftOut;
}

/** The running export as the pill and the sheet show it. */
export interface ExportActivity {
  purpose: ExportPurpose;
  aspect: ExportAspect;
  /** Where it is: asked for, waiting for a renderer, cutting segments, joining them, uploading, or being stopped. */
  phase: "requesting" | "queued" | RenderPhase | "cancelling";
  label: string;
  /** 0–100, or null while nothing measurable has happened. */
  percent: number | null;
  /** False until the server has the job, and while a cancel is on its way. */
  canCancel: boolean;
  cancelling: boolean;
}

/** The plan the server weighs an export by: the playlist's space, or the personal one for a playlist without a space. */
export function planForSpace(orgId: string | undefined, myOrgs: readonly OrgMembership[], fallback: OrgPlanTier): OrgPlanTier {
  const org = orgId ? myOrgs.find((o) => o.orgId === orgId) : myOrgs.find((o) => o.isPersonal);
  return org?.planTier ?? fallback;
}

/** The copies' lengths the desktop's drop rule reads: ready copies only. */
function copyDurations(cloud: EditorCloud): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const id of cloud.readyMatchIds) out.set(id, cloud.videoByMatch.get(id)?.durationSeconds ?? null);
  return out;
}

/** What an export of `selection` (or of the whole playlist) holds and its content key, as the desktop works them out. */
export function exportContentFor({
  playlist,
  eventByKey,
  cloud,
  aspect,
  selection,
}: {
  playlist: Playlist;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  cloud: EditorCloud;
  aspect: ExportAspect;
  selection: readonly string[] | null;
}): ExportContent {
  return exportContentKey({
    playlist,
    eventByKey,
    syncByMatch: cloud.syncByMatch,
    copyDurationByMatch: copyDurations(cloud),
    aspect,
    selection,
  });
}

/**
 * The segment a running export is on, counted from 1: its progress runs
 * over the segments and then the join, and the label names the segment in
 * flight, as the desktop's does.
 */
export function segmentInFlight(progress: number, segments: number): number {
  const done = Math.floor(Math.max(0, progress) * (segments + 1) + 1e-6);
  return Math.min(segments, Math.max(1, done + 1));
}

function activityLabel(a: ActiveExport, segments: number): string {
  if (a.phase === "requesting") return "Starting export…";
  if (a.phase === "queued") return "Waiting to export…";
  if (a.phase === "cancelling") return "Cancelling…";
  if (a.renderPhase === "stitch") return "Joining…";
  if (a.renderPhase === "upload") return "Uploading…";
  if (segments <= 0) return "Exporting…";
  return `Exporting · clip ${segmentInFlight(a.progress, segments)} of ${segments}`;
}

function leftOutOf(noCopy: readonly ShipNoCopy[], dropped: readonly ExportDropped[]): LeftOut {
  return {
    noCopy: noCopy.reduce((n, g) => n + g.eventIds.length, 0),
    pastEnd: dropped.filter((d) => d.reason === "past_end").length,
    noTime: dropped.filter((d) => d.reason === "no_time").length,
  };
}

/** What an export left out, one sentence per reason. */
export function leftOutLines(l: LeftOut): string[] {
  const lines: string[] = [];
  if (l.noCopy > 0) {
    lines.push(l.noCopy === 1 ? "1 clip was left out: its game has no cloud copy." : `${l.noCopy} clips were left out: their games have no cloud copy.`);
  }
  if (l.pastEnd > 0) {
    lines.push(
      l.pastEnd === 1 ? "1 clip starts after its video ends and was left out." : `${l.pastEnd} clips start after their videos end and were left out.`,
    );
  }
  if (l.noTime > 0) {
    lines.push(
      l.noTime === 1 ? "1 clip can't be placed in its video and was left out." : `${l.noTime} clips can't be placed in their videos and were left out.`,
    );
  }
  return lines;
}

/** Stats cards in what is exported, for the desktop's `stats_cards` property. */
function statsCardsIn(playlist: Playlist | null, selection: readonly string[] | null): number {
  if (!playlist) return 0;
  const chosen = selection ? new Set(selection) : null;
  return playlist.items.filter((i) => !isClipItem(i) && !!i.card && (!chosen || chosen.has(itemKey(i)))).length;
}

/** The link's page on this app (the QR must open where this account's links live: staging links on staging). */
function shareUrl(shareId: string): string {
  return `${window.location.origin}/h/${encodeURIComponent(shareId)}`;
}

/**
 * Saves the file: the link carries `Content-Disposition: attachment` with
 * the name, so the browser downloads it and the page stays (a cross-origin
 * link ignores `download`, which is there for a same-origin one).
 */
function saveFile(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sizeMb(bytes: number | undefined): number | null {
  return typeof bytes === "number" && bytes > 0 ? Math.round((bytes / 1_048_576) * 10) / 10 : null;
}

/** What a failed render says, from the renderer's and the function's tokens (workers/game-video-convert/src/export.ts). */
function jobFailureText(error: string | null): string {
  if (error?.startsWith("segment_failed")) return "One of the clips or cards couldn't be rendered.";
  switch (error) {
    case "renderer_unavailable":
      return "The video renderer isn't switched on.";
    case "nothing_to_export":
      return "None of the clips could be cut from their cloud copies.";
    case "stitch_failed":
      return "The clips couldn't be joined into one video.";
    case "source_unreachable":
      return "A game's cloud copy couldn't be read.";
    case "gave_up":
      return "The server tried three times without finishing.";
    default:
      return "The server couldn't make the video. Try again in a moment.";
  }
}

export function useExport({
  playlist,
  eventByKey,
  cloud,
  enabled,
}: {
  playlist: Playlist | null;
  eventByKey: ReadonlyMap<string, PlayByPlayEvent>;
  cloud: EditorCloud;
  /** The owner, with the playlist loaded. */
  enabled: boolean;
}) {
  const router = useRouter();
  const { myOrgs, activeOrgPlan } = useAuth();
  const playlistId = playlist?.id ?? null;
  const plan = useMemo(() => planForSpace(playlist?.orgId, myOrgs, activeOrgPlan), [playlist?.orgId, myOrgs, activeOrgPlan]);

  const [activeState, setActiveState] = useState<ActiveExport | null>(null);
  const activeRef = useRef<ActiveExport | null>(null);
  /** Applies a change to the running export, state and ref together, so a callback that follows reads it. */
  const update = useCallback((fn: (prev: ActiveExport | null) => ActiveExport | null) => {
    const next = fn(activeRef.current);
    activeRef.current = next;
    setActiveState(next);
  }, []);

  const [share, setShare] = useState<(ShareLink & { playlistId: string }) | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The upgrade path, kept after it closes so its words don't change on the way out. */
  const [upgrade, setUpgrade] = useState<{ purpose: ExportPurpose; aspect: ExportAspect; open: boolean } | null>(null);

  const inputsRef = useRef({ playlist, eventByKey, cloud, plan, enabled });
  useLayoutEffect(() => {
    inputsRef.current = { playlist, eventByKey, cloud, plan, enabled };
  });

  const alive = useRef(true);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<(() => Promise<void>) | null>(null);
  /** Each start (and each playlist) gets a generation, so a read from an earlier one is dropped. */
  const generationRef = useRef(0);
  /** The job this client asked to stop: its `cancelled` ending is already being said. */
  const cancelledJobRef = useRef<string | null>(null);
  // Callbacks that call each other through toasts and polls, reached through refs.
  const startRef = useRef<(options: ExportOptions) => Promise<void>>(async () => {});
  const settleRef = useRef<(job: RenderJob) => void>(() => {});
  const saveAgainRef = useRef<(jobId: string, a: ActiveExport) => Promise<void>>(async () => {});

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    pollRef.current = null;
    tickRef.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  // Another playlist opened in the same editor: the old one's export goes
  // on on the server, and is picked up again when that playlist reopens.
  useEffect(
    () => () => {
      generationRef.current++;
      stopPolling();
    },
    [playlistId, stopPolling],
  );

  // Back to the tab: read at once instead of at the next tick.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden || pollRef.current === null || !tickRef.current) return;
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
      void tickRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const showLink = useCallback((link: ShareLink, forPlaylist: string) => {
    setShare({ ...link, playlistId: forPlaylist });
    setSheetOpen(true);
  }, []);

  /** Follows a job until it settles; the first read waits `delay`. */
  const follow = useCallback(
    (jobId: string, generation: number, delay: number) => {
      stopPolling();
      let misses = 0;
      const tick = async () => {
        pollRef.current = null;
        if (!alive.current || generation !== generationRef.current) return;
        if (document.hidden) {
          pollRef.current = window.setTimeout(tick, POLL_MS);
          return;
        }
        const job = await getRenderJob(createClient(), jobId);
        if (!alive.current || generation !== generationRef.current) return;
        if (!job) {
          // Unreadable for now (or gone): keep trying for a while before letting go.
          misses++;
          if (misses >= MAX_MISSES) {
            update((prev) => (prev?.jobId === jobId ? null : prev));
            return;
          }
          pollRef.current = window.setTimeout(tick, POLL_MS);
          return;
        }
        misses = 0;
        if (isRenderJobLive(job.status)) {
          update((prev) =>
            prev?.jobId === jobId
              ? {
                  ...prev,
                  phase: prev.phase === "cancelling" ? "cancelling" : job.status === "queued" ? "queued" : "running",
                  progress: job.progress,
                  renderPhase: job.phase,
                }
              : prev,
          );
          pollRef.current = window.setTimeout(tick, POLL_MS);
          return;
        }
        settleRef.current(job);
      };
      tickRef.current = tick;
      pollRef.current = window.setTimeout(tick, delay);
    },
    [stopPolling, update],
  );

  const downloadFailure = useCallback((token: string, jobId: string, a: ActiveExport) => {
    trackEvent("export_failed", { playlist_id: a.playlistId, purpose: "download", aspect: a.options.aspect, error: token });
    if (token === "export_expired") {
      toast.error("This export is no longer available", {
        description: `Exports are kept for ${EXPORT_KEEP_DAYS} days. Export the playlist again.`,
        action: { label: "Export again", onClick: () => void startRef.current(a.options) },
      });
      return;
    }
    toast.error("Couldn't download the video", {
      description: "Check your connection and try again.",
      action: { label: "Try again", onClick: () => void saveAgainRef.current(jobId, a) },
    });
  }, []);

  /** The file again, from a fresh link (the browser may have held the first one back). */
  const saveAgain = useCallback(
    async (jobId: string, a: ActiveExport) => {
      const link = await exportDownloadLink(createClient(), jobId);
      if (!link.ok) {
        downloadFailure(link.error, jobId, a);
        return;
      }
      saveFile(link.data.url, link.data.filename);
      trackEvent("export_downloaded", { playlist_id: a.playlistId, aspect: a.options.aspect, size_mb: null, again: true });
    },
    [downloadFailure],
  );

  const deliverDownload = useCallback(
    async (job: RenderJob, a: ActiveExport) => {
      const result: ExportJobResult | null = job.exportResult;
      const link = await exportDownloadLink(createClient(), job.id);
      update((prev) => (prev?.jobId === job.id ? null : prev));
      if (!link.ok) {
        downloadFailure(link.error, job.id, a);
        return;
      }
      // Saved even if the editor has gone meanwhile: the file is what was asked for.
      saveFile(link.data.url, link.data.filename);
      const { playlist: pl } = inputsRef.current;
      trackEvent("video_exported", {
        playlist_id: a.playlistId,
        clip_count: result?.clips ?? a.clips,
        status: "success",
        selection_only: a.options.selection !== null,
        stats_cards: statsCardsIn(pl, a.options.selection),
        aspect: a.options.aspect,
        origin: "web",
      });
      trackEvent("export_downloaded", { playlist_id: a.playlistId, aspect: a.options.aspect, size_mb: sizeMb(result?.sizeBytes) });
      const lines = leftOutLines(a.leftOut);
      toast.success("Your video is ready", {
        description: [`Downloading “${link.data.filename}”.`, ...lines].join(" "),
        action: { label: "Download again", onClick: () => void saveAgainRef.current(job.id, a) },
        ...(lines.length > 0 ? { duration: 10_000 } : {}),
      });
    },
    [update, downloadFailure],
  );

  const deliverShare = useCallback(
    (job: RenderJob, a: ActiveExport) => {
      const result = job.exportResult;
      update((prev) => (prev?.jobId === job.id ? null : prev));
      if (!result?.shareId) {
        trackEvent("export_failed", { playlist_id: a.playlistId, purpose: "share", aspect: a.options.aspect, error: "no_share" });
        toast.error("Couldn't make the link", {
          description: "The video was made, but its link wasn't saved. Try again.",
          action: { label: "Try again", onClick: () => void startRef.current(a.options) },
        });
        return;
      }
      showLink(
        {
          shareId: result.shareId,
          url: shareUrl(result.shareId),
          aspect: a.options.aspect,
          reused: false,
          madeDaysAgo: null,
          daysLeft: SHARE_LINK_DAYS,
          selection: a.options.selection,
          leftOut: a.leftOut,
        },
        a.playlistId,
      );
      trackEvent("highlight_sent_to_phone", {
        playlist_id: a.playlistId,
        clip_count: result.clips,
        stats_cards: statsCardsIn(inputsRef.current.playlist, a.options.selection),
        reused: false,
        is_selection: a.options.selection !== null,
        aspect: a.options.aspect,
        origin: "web",
      });
    },
    [update, showLink],
  );

  const settle = useCallback(
    (job: RenderJob) => {
      const a = activeRef.current;
      if (!a || a.jobId !== job.id) return;
      if (job.status === "failed") {
        update(() => null);
        if (job.error === "cancelled") {
          // Stopped here (the cancel says so) or from another window.
          if (cancelledJobRef.current !== job.id) toast("Export cancelled");
          return;
        }
        trackEvent("export_failed", { playlist_id: a.playlistId, purpose: a.options.purpose, aspect: a.options.aspect, error: job.error ?? "unknown" });
        toast.error(a.options.purpose === "share" ? "Couldn't make the link" : "Couldn't export the video", {
          description: jobFailureText(job.error),
          action: { label: "Try again", onClick: () => void startRef.current(a.options) },
        });
        return;
      }
      if (a.options.purpose === "download") void deliverDownload(job, a);
      else deliverShare(job, a);
    },
    [update, deliverDownload, deliverShare],
  );

  /** What a refused request says; every refusal but the plan's is an `export_failed`. */
  const refused = useCallback(
    (token: string, forPlaylist: string, options: ExportOptions) => {
      if (token === "upgrade_required") {
        setUpgrade({ purpose: options.purpose, aspect: options.aspect, open: true });
        return;
      }
      trackEvent("export_failed", { playlist_id: forPlaylist, purpose: options.purpose, aspect: options.aspect, error: token });
      switch (token) {
        case "renderer_unavailable":
          toast("Exports can't be made yet", { description: "The video renderer isn't switched on." });
          return;
        case "nothing_to_export":
          toast("None of these clips can be exported yet", {
            description: "Their games need a cloud video.",
            action: { label: "Open Library", onClick: () => router.push("/library") },
          });
          return;
        case "demo_game":
          toast("The sample game can't be exported", { description: "Import one of your own games to export its clips." });
          return;
        case "not_owner":
          toast.error("Only the playlist's owner can export it");
          return;
        case "feature_disabled":
          toast("Cloud game videos are turned off right now");
          return;
        default:
          toast.error(options.purpose === "share" ? "Couldn't make the link" : "Couldn't start the export", {
            description: "Check your connection and try again.",
            action: { label: "Try again", onClick: () => void startRef.current(options) },
          });
      }
    },
    [router],
  );

  const start = useCallback(
    async (options: ExportOptions) => {
      const { playlist: pl, eventByKey: events, cloud: copies, plan: tier, enabled: on } = inputsRef.current;
      if (!pl || !on) return;
      if (activeRef.current?.playlistId === pl.id) {
        // One at a time: the pill has the running one and its Cancel.
        toast("An export is already running", { description: "Wait for it to finish, or cancel it." });
        return;
      }
      if (tier === "free") {
        setUpgrade({ purpose: options.purpose, aspect: options.aspect, open: true });
        return;
      }
      const generation = ++generationRef.current;
      stopPolling();
      cancelledJobRef.current = null;
      const content = exportContentFor({ playlist: pl, eventByKey: events, cloud: copies, aspect: options.aspect, selection: options.selection });
      update(() => ({
        playlistId: pl.id,
        jobId: null,
        phase: "requesting",
        options,
        segments: content.clips + content.cards,
        clips: content.clips,
        cards: content.cards,
        progress: 0,
        renderPhase: null,
        leftOut: NOTHING_LEFT_OUT,
      }));
      const result = await exportPlaylist(createClient(), {
        playlistId: pl.id,
        aspect: options.aspect,
        purpose: options.purpose,
        ...(options.purpose === "download" ? { watermark: options.watermark } : {}),
        ...(options.selection ? { selection: options.selection } : {}),
        ...(options.purpose === "share" ? { contentKey: content.key } : {}),
        ...(options.fresh ? { fresh: true } : {}),
      });
      if (!alive.current || generation !== generationRef.current) return;
      if (!result.ok) {
        update(() => null);
        refused(result.error, pl.id, options);
        return;
      }
      const r = result.data;
      const isSelection = options.selection !== null;
      trackEvent("export_requested", {
        playlist_id: pl.id,
        purpose: options.purpose,
        aspect: options.aspect,
        watermark: r.watermark,
        is_selection: isSelection,
        clips: r.clips,
        cards: r.cards,
        reused: r.reused,
      });
      const leftOut = leftOutOf(r.noCopy ?? [], r.dropped ?? []);

      if (r.reused && r.share) {
        update(() => null);
        const now = Date.now();
        const expires = r.share.expiresAt ? Date.parse(r.share.expiresAt) : Number.NaN;
        const known = Number.isFinite(expires);
        showLink(
          {
            shareId: r.share.shareId,
            url: shareUrl(r.share.shareId),
            aspect: options.aspect,
            reused: true,
            // Links live SHARE_LINK_DAYS from when they were made.
            madeDaysAgo: known ? Math.max(0, Math.floor((now - (expires - SHARE_LINK_DAYS * DAY_MS)) / DAY_MS)) : null,
            daysLeft: known ? Math.max(0, Math.ceil((expires - now) / DAY_MS)) : null,
            selection: options.selection,
            leftOut,
          },
          pl.id,
        );
        trackEvent("highlight_sent_to_phone", {
          playlist_id: pl.id,
          clip_count: r.clips,
          stats_cards: statsCardsIn(pl, options.selection),
          reused: true,
          is_selection: isSelection,
          aspect: options.aspect,
          origin: "web",
        });
        return;
      }
      if (!r.jobId) {
        update(() => null);
        refused("request_failed", pl.id, options);
        return;
      }
      const jobId = r.jobId;
      update((prev) =>
        prev?.playlistId === pl.id && prev.jobId === null
          ? {
              ...prev,
              jobId,
              phase: r.status === "queued" ? "queued" : "running",
              segments: r.clips + r.cards,
              clips: r.clips,
              cards: r.cards,
              leftOut,
            }
          : prev,
      );
      follow(jobId, generation, isRenderJobLive(r.status) ? POLL_MS : 0);
    },
    [stopPolling, update, refused, showLink, follow],
  );

  const cancel = useCallback(async () => {
    const a = activeRef.current;
    if (!a || !a.jobId || a.phase === "cancelling") return;
    const jobId = a.jobId;
    cancelledJobRef.current = jobId;
    update((prev) => (prev?.jobId === jobId ? { ...prev, phase: "cancelling" } : prev));
    const result = await cancelRender(createClient(), jobId);
    if (!alive.current) return;
    const resume = () => update((prev) => (prev?.jobId === jobId && prev.phase === "cancelling" ? { ...prev, phase: "running" } : prev));
    // `cancelled`: it was stopped already, which is what was asked.
    if (!result.ok && result.error !== "cancelled") {
      cancelledJobRef.current = null;
      resume();
      // A job that is no longer running has its ending read by the next poll; anything else is worth saying.
      if (result.error !== "wrong_status" && result.error !== "not_found") {
        toast.error("Couldn't cancel the export", { description: "Check your connection and try again." });
      }
      return;
    }
    if (result.ok && result.data.status === "done") {
      // It finished first: the next read delivers it.
      cancelledJobRef.current = null;
      resume();
      return;
    }
    if (activeRef.current?.jobId === jobId) {
      generationRef.current++;
      stopPolling();
      update(() => null);
    }
    trackEvent("export_cancelled", {
      playlist_id: a.playlistId,
      purpose: a.options.purpose,
      aspect: a.options.aspect,
      progress: Math.round(a.progress * 100) / 100,
    });
    toast("Export cancelled");
  }, [update, stopPolling]);

  useLayoutEffect(() => {
    startRef.current = start;
    settleRef.current = settle;
    saveAgainRef.current = saveAgain;
  });

  // Arriving on a playlist whose export is running (a reload mid-job): pick it up where it is.
  useEffect(() => {
    if (!enabled || !playlistId) return;
    const seen = generationRef.current;
    let cancelled = false;
    void getLiveRenderJob(createClient(), playlistId, "export").then((job) => {
      if (cancelled || !alive.current || generationRef.current !== seen || !job?.exportRequest) return;
      if (activeRef.current?.playlistId === playlistId) return;
      const generation = ++generationRef.current;
      const req = job.exportRequest;
      update(() => ({
        playlistId,
        jobId: job.id,
        phase: job.status === "queued" ? "queued" : "running",
        options: { purpose: req.purpose, aspect: req.aspect, watermark: req.watermark, selection: req.selection },
        segments: 0,
        clips: 0,
        cards: 0,
        progress: job.progress,
        renderPhase: job.phase,
        leftOut: NOTHING_LEFT_OUT,
      }));
      follow(job.id, generation, POLL_MS);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, playlistId, update, follow]);

  // ---------------------------------------------------------------------------
  // What the editor shows
  // ---------------------------------------------------------------------------

  const active = activeState?.playlistId === playlistId ? activeState : null;
  // A job picked up after a reload: count its segments from the rows, as the dialog would have.
  const knownSegments = active?.segments ?? 0;
  const pickedUpOptions = active && knownSegments === 0 ? active.options : null;
  const countedSegments = useMemo(() => {
    if (!pickedUpOptions || !playlist) return 0;
    const c = exportContentFor({ playlist, eventByKey, cloud, aspect: pickedUpOptions.aspect, selection: pickedUpOptions.selection });
    return c.clips + c.cards;
  }, [pickedUpOptions, playlist, eventByKey, cloud]);

  const activity = useMemo<ExportActivity | null>(() => {
    if (!active) return null;
    const segments = knownSegments || countedSegments;
    const measured = active.phase === "running" || (active.phase === "cancelling" && active.progress > 0);
    return {
      purpose: active.options.purpose,
      aspect: active.options.aspect,
      phase: active.phase === "running" ? (active.renderPhase ?? "clips") : active.phase,
      label: activityLabel(active, segments),
      percent: measured ? active.progress * 100 : null,
      canCancel: active.jobId !== null && active.phase !== "cancelling",
      cancelling: active.phase === "cancelling",
    };
  }, [active, knownSegments, countedSegments]);

  const currentShare = share?.playlistId === playlistId ? share : null;

  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const closeUpgrade = useCallback(() => setUpgrade((u) => (u ? { ...u, open: false } : u)), []);

  /** "Create new link": the same content rendered again, as a link of its own. */
  const createNewLink = useCallback(() => {
    const s = currentShare;
    if (!s) return;
    void start({ purpose: "share", aspect: s.aspect, watermark: true, selection: s.selection, fresh: true });
  }, [currentShare, start]);

  const linkCopied = useCallback(() => {
    if (!currentShare) return;
    trackEvent("export_link_copied", { playlist_id: currentShare.playlistId, aspect: currentShare.aspect });
  }, [currentShare]);

  return {
    /** The plan of the playlist's space, which decides the mark and whether exports are open at all. */
    plan,
    /** The editor has what an export needs (the owner, the playlist, the copies). */
    ready: enabled && cloud.loaded,
    /** An export of this playlist is running: another waits for it. */
    busy: active !== null,
    activity,
    start,
    cancel,
    share: currentShare,
    sheetOpen: sheetOpen && currentShare !== null,
    closeSheet,
    createNewLink,
    linkCopied,
    upgrade,
    closeUpgrade,
  };
}

export type UseExport = ReturnType<typeof useExport>;
