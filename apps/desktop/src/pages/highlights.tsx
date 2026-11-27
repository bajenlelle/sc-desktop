/**
 * Highlights: a player's best plays, framed for their phone (2026-11-27).
 *
 * One page, top to bottom: who the player is (asked once), the games they played in (the best one picked),
 * the plays in the video as a row of 9:16 tiles in the video's order (drag to reorder), and the other plays to
 * add. Each play in the video is framed by Claude as soon as it's there (lib/use-highlights.ts); a tile shows the
 * framed still, and "Check" when the framing should get a look. Clicking a tile opens the clip with the crop window
 * to adjust it. Making the video is the next step.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Reorder } from "framer-motion";
import { AlertTriangle, Check, Film, Pause, Play, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { cropWidthFrac, cxAt, type CropKeyframe } from "@scoutable/shared/lib/crop-path";
import { playClock } from "@scoutable/shared/lib/events";
import { sampleTimes } from "@scoutable/shared/lib/highlight-framing";
import { estimatedSeconds, type HighlightCandidate } from "@scoutable/shared/lib/highlight-picks";
import { CropOverlay, upsertKeyframe } from "@/components/crop-editor";
import { EmptyState } from "@/components/empty-state";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GroupedList, GroupHeader, GroupRow } from "@/components/ui/group";
import { SearchField } from "@/components/ui/search-field";
import { VideoPlayer } from "@/components/video-player";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { streamFileSrc } from "@/lib/stream";
import { useHighlightStill } from "@/lib/highlight-stills";
import { useHighlights, type Framing, type HighlightPlay } from "@/lib/use-highlights";
import { cn } from "@/lib/utils";

/** "Dunk", "3PT", "Steal + dunk": what the play is, as a tile label. */
function playName(c: HighlightCandidate): string {
  const shot = c.kind === "dunk" ? "Dunk" : c.kind === "three" ? "3PT" : c.kind === "two" ? "2PT" : c.kind === "block" ? "Block" : "Steal";
  const name = c.events.length > 1 ? `Steal + ${shot.toLowerCase()}` : shot;
  return c.andOne ? `${name} and one` : name;
}

function scoreLine(c: HighlightCandidate): string | null {
  const e = c.anchor;
  return e.scoreHome != null && e.scoreAway != null ? `${e.scoreHome}–${e.scoreAway}` : null;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Where a framed tile's still is taken: at the release when Claude saw it, else at the play. */
function stillAt(p: HighlightPlay, f: Framing | undefined): number {
  if (!p.window) return 0;
  if (f?.state === "ready" && f.clip.observation.releaseImage != null) {
    const times = sampleTimes(p.window.start, p.window.end);
    return times[Math.min(times.length - 1, Math.max(0, f.clip.observation.releaseImage - 1))];
  }
  return Math.max(p.window.start, p.window.end - 2.5);
}

const CROP_W = cropWidthFrac(1920, 1080);

export function HighlightsPage() {
  const h = useHighlights();
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const inVideo = h.order.map((k) => h.playByKey.get(k)).filter((p): p is HighlightPlay => !!p);
  const more = h.plays.filter((p) => !h.order.includes(p.candidate.key));
  const seconds = inVideo.reduce((s, p) => {
    const f = h.framing.get(p.candidate.key);
    const w = f?.state === "ready" ? f.clip.window : null;
    return s + (w ? w.end - w.start : estimatedSeconds(p.candidate));
  }, 0);
  const framingCount = inVideo.filter((p) => h.framing.get(p.candidate.key)?.state === "framing").length;
  const editingPlay = editing ? h.playByKey.get(editing) : undefined;

  const body = () => {
    if (h.loading) {
      return (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-fill-1" />)}
        </div>
      );
    }
    if (h.games.length === 0) {
      return (
        <EmptyState
          icon={<Film />}
          title="No games yet"
          body="Import a game you played in to make a highlight from it."
          action={<Button asChild><Link to="/upload">Import game</Link></Button>}
        />
      );
    }
    if (!h.player || choosing) {
      return <PlayerPicker players={h.players} onPick={async (p) => { await h.choosePlayer(p); setChoosing(false); }} onCancel={h.player ? () => setChoosing(false) : undefined} />;
    }
    if (h.mine.length === 0) {
      return (
        <EmptyState
          icon={<Film />}
          title={`No games with ${h.player.name}`}
          body="None of your imported games has a play of yours. Import a game you played in, or pick a different player."
          action={<Button variant="outline" onClick={() => setChoosing(true)}>Change player</Button>}
        />
      );
    }
    return (
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-sm">
            <span className="text-muted-foreground">Your plays as </span>
            <span className="font-medium">{h.player.number ? `#${h.player.number} ` : ""}{h.player.name}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setChoosing(true)}>Change player</Button>
        </div>
        <section>
          <GroupHeader title="Games" />
          <GroupedList>
            {h.mine.map((g) => {
              const missing = h.missingVideo.has(g.id);
              const blocked = missing || !g.synced;
              const on = h.selected.has(g.id);
              return (
                <GroupRow
                  key={g.id}
                  onClick={blocked ? undefined : () => h.toggleGame(g.id)}
                  disabled={blocked}
                  leading={
                    <span className={cn("flex size-5 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-separator")}>
                      {on && <Check className="size-3.5" />}
                    </span>
                  }
                  label={`${g.homeTeam} – ${g.awayTeam}`}
                  description={`${formatDate(g.date)} · ${g.line}`}
                  trailing={missing ? <Badge variant="warning">Video missing</Badge> : !g.synced ? <Badge variant="secondary">Not synced</Badge> : undefined}
                />
              );
            })}
          </GroupedList>
        </section>

        <section aria-label="Your video">
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h2 className="text-headline">Your video</h2>
            <p className="text-subheadline text-muted-foreground nums">
              {inVideo.length === 1 ? "1 play" : `${inVideo.length} plays`} · about {Math.round(seconds)} s
              {framingCount > 0 && ` · Framing ${framingCount}…`}
            </p>
          </div>
          {inVideo.length === 0 ? (
            <p className="rounded-lg bg-fill-1 px-4 py-6 text-center text-sm text-muted-foreground">
              {h.selected.size === 0
                ? "No game picked. Pick a game above to see your plays."
                : more.length > 0
                  ? "No plays in the video. Add plays from below."
                  : "No made baskets, blocks or steals of yours in these games. Pick another game."}
            </p>
          ) : (
            <VideoStrip plays={inVideo} framing={h.framing} onReorder={h.reorder} onRemove={h.remove} onOpen={setEditing} onRetry={h.retry} />
          )}
        </section>

        {more.length > 0 && (
          <section aria-label="More plays">
            <h2 className="mb-2 px-1 text-headline">More plays</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {more.map((p) => <MoreTile key={p.candidate.key} play={p} onAdd={() => h.add(p.candidate.key)} />)}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <Page>
      <Toolbar
        title="Highlights"
        subtitle="Your best plays, framed for your phone"
        actions={
          <Button disabled title="Making the video comes next">
            <Sparkles />
            Create video
          </Button>
        }
      />
      <PageContent width="medium">{body()}</PageContent>
      {editingPlay && (
        <CropDialog
          play={editingPlay}
          framing={h.framing.get(editingPlay.candidate.key)}
          onClose={() => setEditing(null)}
          onSave={(kfs) => {
            h.setKeyframes(editingPlay.candidate.key, kfs);
            setEditing(null);
          }}
        />
      )}
    </Page>
  );
}

function PlayerPicker({ players, onPick, onCancel }: {
  players: ReturnType<typeof useHighlights>["players"];
  onPick: (p: ReturnType<typeof useHighlights>["players"][number]) => Promise<void>;
  onCancel?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? players.filter((p) => p.name.toLowerCase().includes(q) || p.number === q.replace("#", "")) : players;
    const byTeam = new Map<string, typeof players>();
    for (const p of list) byTeam.set(p.teamName, [...(byTeam.get(p.teamName) ?? []), p]);
    return [...byTeam.entries()];
  }, [players, query]);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div className="px-1">
        <h2 className="text-title-3">Who are you?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick yourself once. Your plays are found by this in every game you import.</p>
      </div>
      <SearchField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or number" aria-label="Search players" />
      {shown.map(([team, list]) => (
        <section key={team}>
          <GroupHeader title={team} />
          <GroupedList>
            {list.map((p) => (
              <GroupRow
                key={p.personId}
                onClick={saving ? undefined : async () => {
                  setSaving(p.personId);
                  try { await onPick(p); } finally { setSaving(null); }
                }}
                leading={<span className="w-8 text-right text-muted-foreground nums">{p.number ? `#${p.number}` : ""}</span>}
                label={p.name}
                trailing={saving === p.personId ? <span className="text-xs text-muted-foreground">Saving…</span> : undefined}
                chevron
              />
            ))}
          </GroupedList>
        </section>
      ))}
      {onCancel && <Button variant="ghost" className="self-start" onClick={onCancel}>Cancel</Button>}
    </div>
  );
}

function VideoStrip({ plays, framing, onReorder, onRemove, onOpen, onRetry }: {
  plays: HighlightPlay[];
  framing: Map<string, Framing>;
  onReorder: (keys: string[]) => void;
  onRemove: (key: string) => void;
  onOpen: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const reduced = useReducedMotionSafe();
  // A drop ends with a click on the tile under the pointer: ignore the click that comes right after a drag.
  const dragging = useRef(false);
  const open = (key: string) => {
    if (!dragging.current) onOpen(key);
  };
  return (
    <Reorder.Group
      axis="x"
      values={plays.map((p) => p.candidate.key)}
      onReorder={onReorder}
      className="flex gap-3 overflow-x-auto pb-2"
    >
      {plays.map((p, i) => (
        <Reorder.Item
          key={p.candidate.key}
          value={p.candidate.key}
          transition={reduced ? { duration: 0 } : springs.standard}
          whileDrag={{ scale: 1.03 }}
          onDragStart={() => { dragging.current = true; }}
          onDragEnd={() => { window.setTimeout(() => { dragging.current = false; }, 100); }}
          className="shrink-0 cursor-grab active:cursor-grabbing"
        >
          <VideoTile play={p} index={i} framing={framing.get(p.candidate.key)} onRemove={() => onRemove(p.candidate.key)} onOpen={() => open(p.candidate.key)} onRetry={() => onRetry(p.candidate.key)} />
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}

function VideoTile({ play, index, framing, onRemove, onOpen, onRetry }: {
  play: HighlightPlay;
  index: number;
  framing: Framing | undefined;
  onRemove: () => void;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const ready = framing?.state === "ready" ? framing : null;
  const at = stillAt(play, framing);
  const still = useHighlightStill(
    ready && play.match.videoUrl ? { path: play.match.videoUrl, at, crop: { cx: cxAt(ready.clip.keyframes, at), w: CROP_W } } : null,
  );
  const c = play.candidate;
  return (
    <div className="group relative flex w-[150px] flex-col gap-1.5">
      <button
        type="button"
        onClick={ready ? onOpen : framing?.state === "failed" ? onRetry : undefined}
        aria-label={`${playName(c)}, ${playClock(c.anchor)}`}
        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-fill-1 outline-none transition-transform duration-100 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-selection"
      >
        {still ? (
          <img src={still} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className={cn("absolute inset-0", framing?.state !== "failed" && "animate-pulse bg-fill-2")} />
        )}
        <span className="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-black/55 text-[11px] font-semibold text-white nums">{index + 1}</span>
        {framing?.state === "framing" && (
          <span className="absolute inset-x-0 bottom-2 text-center text-xs font-medium text-muted-foreground">Framing…</span>
        )}
        {framing?.state === "failed" && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center text-xs text-muted-foreground">
            <RotateCcw className="size-4" />
            {framing.error === "too_many_requests" ? "Daily limit reached. Try again tomorrow." : framing.error === "framing_disabled" ? "Framing is off right now." : "Couldn't frame this play. Click to try again."}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove from the video"
        className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X className="size-3.5" />
      </button>
      <div className="px-0.5 text-xs leading-tight">
        <p className="font-medium text-foreground">{playName(c)}</p>
        <p className="text-muted-foreground nums">{playClock(c.anchor)}{scoreLine(c) ? ` · ${scoreLine(c)}` : ""}</p>
        {ready?.clip.check && !ready.edited && (
          <button type="button" onClick={onOpen} className="mt-1 inline-flex items-center gap-1 font-medium text-warning outline-none hover:underline focus-visible:ring-2 focus-visible:ring-selection">
            <AlertTriangle className="size-3" />
            Check framing
          </button>
        )}
      </div>
    </div>
  );
}

function MoreTile({ play, onAdd }: { play: HighlightPlay; onAdd: () => void }) {
  const c = play.candidate;
  const still = useHighlightStill(play.window && play.match.videoUrl ? { path: play.match.videoUrl, at: Math.max(play.window.start, play.window.end - 2.5), crop: null } : null);
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={!play.window}
      className="group flex flex-col gap-1.5 rounded-xl text-left outline-none transition-transform duration-100 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-selection disabled:opacity-50"
    >
      <span className="relative aspect-video w-full overflow-hidden rounded-xl bg-fill-1">
        {still && <img src={still} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />}
        <span className="absolute right-1.5 bottom-1.5 flex size-7 items-center justify-center rounded-full bg-black/55 text-white transition-colors group-hover:bg-primary"><Plus className="size-4" /></span>
      </span>
      <span className="px-0.5 text-xs leading-tight">
        <span className="block font-medium text-foreground">{playName(c)}</span>
        <span className="block text-muted-foreground nums">{playClock(c.anchor)}{scoreLine(c) ? ` · ${scoreLine(c)}` : ""}</span>
      </span>
    </button>
  );
}

/** The clip with the 9:16 window over it, playing its window on a loop; dragging the window saves a keyframe. */
function CropDialog({ play, framing, onClose, onSave }: {
  play: HighlightPlay;
  framing: Framing | undefined;
  onClose: () => void;
  onSave: (keyframes: CropKeyframe[]) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ready = framing?.state === "ready" ? framing.clip : null;
  const [kfs, setKfs] = useState<CropKeyframe[]>(ready?.keyframes ?? []);
  const win = ready?.window ?? play.window;
  const [playing, setPlaying] = useState(false);

  if (!play.match.videoUrl || !win) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{playName(play.candidate)} · {playClock(play.candidate.anchor)}</DialogTitle>
          <DialogDescription>Drag the window to keep yourself in the frame. Each drag sets the window at that moment.</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          <LoopingClip src={streamFileSrc(play.match.videoUrl)} videoRef={videoRef} start={win.start} end={win.end} onPlaying={setPlaying} />
          <CropOverlay videoRef={videoRef} keyframes={kfs} dimmed={false} onCommit={(t, cx) => setKfs((k) => upsertKeyframe(k, t, cx))} />
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              if (v.paused) void v.play().catch(() => {});
              else v.pause();
            }}
          >
            {playing ? <Pause /> : <Play />}
            {playing ? "Pause" : "Play"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave(kfs)}>Save framing</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The clip's window on a loop, muted, from its start. Its own component so the effect runs once the video exists:
 * the dialog's content mounts after the dialog itself (Radix portal). Media events don't bubble, so they're on the video.
 */
function LoopingClip({ src, videoRef, start, end, onPlaying }: {
  src: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  start: number;
  end: number;
  onPlaying: (playing: boolean) => void;
}) {
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const begin = () => {
      v.currentTime = start;
      v.muted = true;
      void v.play().catch(() => {});
    };
    const loop = () => {
      if (v.currentTime >= end || v.currentTime < start - 0.5) v.currentTime = start;
    };
    const onPlay = () => onPlaying(true);
    const onPause = () => onPlaying(false);
    if (v.readyState >= HTMLMediaElement.HAVE_METADATA) begin();
    else v.addEventListener("loadedmetadata", begin, { once: true });
    v.addEventListener("timeupdate", loop);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", begin);
      v.removeEventListener("timeupdate", loop);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [videoRef, start, end, onPlaying]);
  return <VideoPlayer src={src} videoRef={videoRef} />;
}
