import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PenLine, Scissors, Snail, Tag } from "lucide-react";
import { HOLD_DEFAULT, withDrawing, type ClipDrawing } from "@scoutable/shared/lib/clip-drawing";
import { SLOW_MAX_LENGTH, clampSlowLength, slowAtPlayhead, slowRoom, slowStartingAt, type SlowSection } from "@scoutable/shared/lib/clip-timeline";
import { clipBounds, computeVideoTime } from "@scoutable/shared/lib/clip-timing";
import { eventLabel, playClock, playerName } from "@scoutable/shared/lib/events";
import { clamp } from "@scoutable/shared/lib/motion-math";
import { offsetsForTrim } from "@scoutable/shared/lib/trim-math";
import type { Label } from "@scoutable/shared/types/labels";
import type { ClipBrowserLabelHandlers } from "@/components/editor/clip-browser-panel";
import { ClipNoteField } from "@/components/editor/clip-note-field";
import { ClipTrimmer, type TrimWindow } from "@/components/editor/clip-trimmer";
import { DrawBar } from "@/components/editor/draw-bar";
import { DrawOverlay } from "@/components/editor/draw-overlay";
import { PlayerStage, type PlayerStageHandle } from "@/components/editor/player-stage";
import { SlowBar } from "@/components/editor/slow-bar";
import { useDrawSession } from "@/components/editor/use-draw-session";
import { usePersistentVideo } from "@/components/editor/use-persistent-video";
import { LabelChip } from "@/components/labels/LabelChip";
import { LabelPickerPopover } from "@/components/labels/LabelPickerPopover";
import { ClipCaption } from "@/components/player/clip-caption";
import { DrawingLayer } from "@/components/player/drawing-layer";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trackEvent } from "@/lib/analytics";
import { streamFileSrc } from "@/lib/stream";
import { useClipEffects, type EffectDrawing } from "@/lib/use-clip-effects";
import type { useClipEdit } from "@/lib/use-clip-edit";
import type { PlayByPlayEvent, PlaylistClipItem, StoredMatch } from "@/types/match";

export interface ReportClipEditorProps {
  /** The report's playlist (its clips' container). */
  playlistId: string;
  clip: PlaylistClipItem;
  event: PlayByPlayEvent | undefined;
  match: StoredMatch | undefined;
  /** The game's video file when it is on this computer, else null. */
  videoPath: string | null;
  /** The section the clip is in, for the header. */
  sectionLabel: string | null;
  /** Where the clip is in the report's reading order. */
  position: { index: number; total: number } | null;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  preRoll: number;
  postRoll: number;
  labels: readonly Label[];
  assigned: ReadonlySet<string>;
  labelHandlers: ClipBrowserLabelHandlers;
  edit: ReturnType<typeof useClipEdit>;
  onDone: () => void;
  /** Draw or trim is open: the sheet's Esc ends that first. */
  onBusyChange: (busy: boolean) => void;
}

/**
 * Edit clip, from inside the report (docs/scouting-reports.md, "The report's
 * clips"): the clip plays on its own stage, and under it the editor's tools
 * for one clip: Draw, Slow motion, Trim and its note, with its labels. The
 * same pieces as the playlist editor (PlayerStage, ClipTrimmer, DrawOverlay,
 * SlowBar, ClipNoteField) and the same rules (clip-timeline.ts,
 * clip-drawing.ts, trim-math.ts); every change saves as it is made
 * (use-clip-edit.ts). ‹ and › step through the report's clips in reading order.
 */
export function ReportClipEditor(props: ReportClipEditorProps) {
  const { clip, event, match, videoPath, preRoll, postRoll, edit } = props;
  const key = `${clip.matchId}:${clip.eventId}`;
  const video = usePersistentVideo();
  const stageRef = useRef<PlayerStageHandle | null>(null);
  const [speed, setSpeed] = useState(1);

  // Where the clip runs in the game's video, with its own trim.
  const eventTime = useMemo(() => (event && match?.syncPoint ? computeVideoTime(event, match.syncPoint) : null), [event, match?.syncPoint]);
  const span = useMemo(
    () => (eventTime === null ? null : clipBounds(eventTime, preRoll, postRoll, clip.preRollOffset, clip.postRollOffset)),
    [eventTime, preRoll, postRoll, clip.preRollOffset, clip.postRollOffset],
  );
  const src = videoPath && span ? streamFileSrc(videoPath) : null;
  const why = !videoPath ? "The game’s video isn’t on this computer." : eventTime === null ? "This game isn’t synced to its video yet." : null;

  const draw = useDrawSession();
  const [trim, setTrim] = useState<{ start: number; end: number } | null>(null);
  const [slowId, setSlowId] = useState<string | null>(null);
  const busy = !!draw.session || !!trim;
  const onBusyChange = props.onBusyChange;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // The clip's own stretch: it plays from its start and stops at its end; Play at the end starts it over.
  const spanRef = useRef(span);
  spanRef.current = span;
  const holdRef = useRef(false);
  holdRef.current = busy;
  const playFromStart = useCallback(() => {
    const w = spanRef.current;
    if (!w) return;
    video.pause();
    video.currentTime = w.start;
    video.addEventListener("seeked", () => !holdRef.current && video.play().catch(() => {}), { once: true });
  }, [video]);
  useEffect(() => {
    const onTime = () => {
      const w = spanRef.current;
      if (!w || holdRef.current || video.seeking) return;
      if (video.currentTime >= w.end && !video.paused) video.pause();
    };
    const onPlay = () => {
      const w = spanRef.current;
      if (!w || holdRef.current) return;
      if (video.currentTime >= w.end - 0.05 || video.currentTime < w.start - 0.5) video.currentTime = w.start;
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.pause();
    };
  }, [video]);
  // A new clip (or the sheet opening) plays from its start, once the video can seek.
  const shownKey = src ? key : null;
  useEffect(() => {
    if (!shownKey) return;
    if (video.readyState >= 1) playFromStart();
    else video.addEventListener("loadedmetadata", playFromStart, { once: true });
    return () => video.removeEventListener("loadedmetadata", playFromStart);
  }, [shownKey, video, playFromStart]);

  // The clip's drawings and slow motion as it plays: frozen frames and slowed stretches.
  const effectDrawings = useMemo<EffectDrawing[]>(() => {
    if (!span || !clip.drawings) return [];
    return clip.drawings.filter((d) => d.t > span.start + 0.1 && d.t < span.end - 0.1).map((d) => ({ id: d.id, at: d.t, hold: d.hold, shapes: d.shapes }));
  }, [clip.drawings, span]);
  const effectSlows = useMemo(() => (clip.slowMotion ?? []).map((s) => ({ at: s.t, length: s.length, rate: s.rate })), [clip.slowMotion]);
  const fx = useClipEffects(video, { drawings: effectDrawings, slows: effectSlows }, speed, !!src && !busy);

  // ---------------------------------------------------------------------------
  // Draw: on the playhead's frame, saved as it changes and once more on Done.
  // ---------------------------------------------------------------------------
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const drawingsAtStart = useRef<ClipDrawing[] | undefined>(undefined);
  function enterDraw(existing?: ClipDrawing) {
    if (!span || !src) return;
    finishDraw();
    closeSlow();
    setTrim(null);
    fx.cancel();
    video.pause();
    const hit = existing ?? clip.drawings?.find((d) => Math.abs(d.t - video.currentTime) <= 0.05);
    const t = hit?.t ?? Math.round(clamp(video.currentTime, span.start + 0.1, span.end - 0.1) * 1000) / 1000;
    if (Math.abs(video.currentTime - t) > 0.001) video.currentTime = t;
    drawingsAtStart.current = clip.drawings;
    draw.start(key, hit ?? { id: crypto.randomUUID(), t, hold: HOLD_DEFAULT, shapes: [] });
  }
  function finishDraw(opts: { remove?: boolean } = {}) {
    const ended = draw.end();
    if (!ended) return;
    const d = opts.remove ? { ...ended, shapes: [] } : ended;
    const c = clipRef.current;
    const next = withDrawing(c.drawings, d);
    edit.change(c, { drawings: next }, true);
    if (JSON.stringify(drawingsAtStart.current ?? []) !== JSON.stringify(next)) {
      trackEvent("clip_drawing_set", {
        shapes: d.shapes.length,
        spotlights: d.shapes.filter((s) => s.kind === "spotlight").length,
        arrows: d.shapes.filter((s) => s.kind === "arrow").length,
        texts: d.shapes.filter((s) => s.kind === "text").length,
        hold_seconds: d.hold,
        drawings_on_clip: next.length,
        removed: d.shapes.length === 0,
      });
    }
  }
  const drawing = draw.session?.drawing;
  useEffect(() => {
    if (!drawing) return;
    const c = clipRef.current;
    const next = withDrawing(c.drawings, drawing);
    if (JSON.stringify(c.drawings ?? []) !== JSON.stringify(next)) edit.change(c, { drawings: next });
    // A change in the drawing is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);

  // ---------------------------------------------------------------------------
  // Slow motion: the section at the playhead, or a new one from here.
  // ---------------------------------------------------------------------------
  const slowAtOpen = useRef<SlowSection[] | undefined>(undefined);
  const sections = clip.slowMotion ?? [];
  const slowSection = slowId ? (sections.find((s) => s.id === slowId) ?? null) : null;
  function setSlows(next: SlowSection[]) {
    edit.change(clipRef.current, { slowMotion: [...next].sort((a, b) => a.t - b.t) });
  }
  function openSlowMotion() {
    if (!span || !src) return;
    finishDraw();
    setTrim(null);
    const at = slowAtPlayhead(sections, video.currentTime, span.start, span.end, () => crypto.randomUUID());
    if (!at) return;
    if (at.seekTo !== null) video.currentTime = at.seekTo;
    closeSlow();
    slowAtOpen.current = sections;
    setSlowId(at.open.id);
    if (at.created) setSlows([...sections, at.open]);
  }
  function closeSlow() {
    if (!slowId) return;
    edit.flush();
    const now = clipRef.current.slowMotion ?? [];
    setSlowId(null);
    if (JSON.stringify(slowAtOpen.current ?? []) === JSON.stringify(now)) return;
    const section = now.find((s) => s.id === slowId);
    trackEvent("clip_slow_motion_set", { rate: section?.rate ?? null, length_seconds: section?.length ?? 0, sections_on_clip: now.length, removed: !section });
  }

  // ---------------------------------------------------------------------------
  // Trim: the clip's ends on handles over the player.
  // ---------------------------------------------------------------------------
  function startTrim() {
    if (!span || !src || trim) return;
    finishDraw();
    closeSlow();
    video.pause();
    setTrim({ start: span.start, end: span.end });
  }
  function endTrim(result: TrimWindow | null) {
    const was = trim;
    setTrim(null);
    if (!was || eventTime === null) return;
    const inChanged = !!result && Math.abs(result.start - was.start) >= 0.05;
    const outChanged = !!result && Math.abs(result.end - was.end) >= 0.05;
    let start = was.start;
    if (result && (inChanged || outChanged)) {
      const offsets = offsetsForTrim({ eventTime, start: result.start, end: result.end, preRoll, postRoll });
      void edit.saveLength(clip, offsets.preRollOffset, offsets.postRollOffset);
      const w = clipBounds(eventTime, preRoll, postRoll, offsets.preRollOffset, offsets.postRollOffset);
      start = w.start;
      trackEvent("clip_trimmed", { playlist_id: props.playlistId, via: "report", in_changed: inChanged, out_changed: outChanged, length_seconds: Math.round((w.end - w.start) * 10) / 10 });
    }
    video.pause();
    video.currentTime = start;
  }
  const trimmed = (clip.preRollOffset ?? 0) !== 0 || (clip.postRollOffset ?? 0) !== 0;

  // ---------------------------------------------------------------------------
  // The note: saved as it is typed.
  // ---------------------------------------------------------------------------
  const [note, setNote] = useState(clip.note ?? "");
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const noteAtFocus = useRef("");

  // Another clip (‹ ›): whatever was open on this one closes and saves, and its note comes in.
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setNote(clip.note ?? "");
    setTrim(null);
    setSlowId(null);
    // The previous clip's drawing was saved through the session's clip (finishDraw reads clipRef, now the new clip): end it unsaved here.
    draw.end();
    edit.flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Leaving: a drawing still open is saved.
  const finishRef = useRef(finishDraw);
  finishRef.current = finishDraw;
  useEffect(() => () => finishRef.current(), []);

  // D draws, T trims, as in the editor; not while typing or drawing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (draw.session || trim) return;
      if (e.key === "d") {
        e.preventDefault();
        enterDraw();
      } else if (e.key === "t") {
        e.preventDefault();
        startTrim();
      } else if (e.key === "r" && src) {
        e.preventDefault();
        playFromStart();
      } else if (e.key === "ArrowUp" && props.onPrev) {
        e.preventDefault();
        props.onPrev();
      } else if (e.key === "ArrowDown" && props.onNext) {
        e.preventDefault();
        props.onNext();
      } else if (e.key === " " && src && t?.tagName !== "BUTTON") {
        e.preventDefault();
        stageRef.current?.togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const assignedLabels = props.labels.filter((l) => props.assigned.has(l.id));
  const where = event ? `${playClock(event)}${props.sectionLabel ? ` · In ${props.sectionLabel}` : ""}` : props.sectionLabel ? `In ${props.sectionLabel}` : "";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <SheetTitle className="truncate">{event ? `${eventLabel(event)} · ${playerName(event)}` : "Edit clip"}</SheetTitle>
          <SheetDescription className="truncate">{where}</SheetDescription>
        </div>
        <Button size="sm" onClick={props.onDone}>
          Done
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5">
        {src ? (
          <div className="relative">
            <PlayerStage
              handleRef={stageRef}
              video={video}
              src={src}
              title={event ? eventLabel(event) : undefined}
              position={props.position}
              clipWindow={span}
              onSeek={(t) => {
                fx.cancel();
                video.currentTime = t;
              }}
              transport={{
                isQueueActive: true,
                canPrev: !!props.onPrev,
                canNext: !!props.onNext,
                onPrev: () => props.onPrev?.(),
                onNext: () => props.onNext?.(),
                onReplay: playFromStart,
                onStop: () => video.pause(),
                hideStop: true,
                onPlayAll: playFromStart,
              }}
              speed={speed}
              onSpeedChange={setSpeed}
              interactive={!draw.session}
              hideChrome={!!draw.session}
              hold={{ active: !!fx.holding, cancel: fx.cancel }}
              drawings={draw.session ? undefined : effectDrawings.map((d) => ({ id: d.id, t: d.at, hold: d.hold }))}
              onDrawingClick={(id) => enterDraw(clip.drawings?.find((d) => d.id === id))}
              slows={draw.session ? undefined : clip.slowMotion}
              selectedSlowId={slowId}
              onSlowClick={(id) => {
                const s = sections.find((x) => x.id === id);
                if (!s) return;
                finishDraw();
                fx.cancel();
                video.currentTime = s.t;
                closeSlow();
                slowAtOpen.current = sections;
                setSlowId(s.id);
              }}
              trimBar={
                trim && eventTime !== null ? (
                  <ClipTrimmer key={key} video={video} eventTime={eventTime} initial={trim} onCancel={() => endTrim(null)} onDone={(w) => endTrim(w)} />
                ) : undefined
              }
            >
              {draw.session && (
                <DrawOverlay
                  session={draw.session}
                  onAdd={draw.addShape}
                  onUpdate={draw.updateShape}
                  onRecord={draw.pushHistory}
                  onRemove={draw.removeShape}
                  onSelect={draw.select}
                  onUndo={draw.undo}
                  onRedo={draw.redo}
                  onTool={draw.setTool}
                  onArrowKind={draw.setArrowKind}
                  onDone={() => finishDraw()}
                />
              )}
              {!draw.session && fx.shown && <DrawingLayer key={fx.shown.id} shapes={fx.shown.shapes} />}
              {!draw.session && note.trim() && <ClipCaption text={note} preview />}
            </PlayerStage>
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-span bg-fill-2 p-6 text-center ring-1 ring-separator">
            <p className="max-w-[34ch] text-callout text-muted-foreground [text-wrap:balance]">{why ?? "This clip can’t play here."}</p>
          </div>
        )}

        {draw.session && (
          <DrawBar
            session={draw.session}
            canUndo={draw.canUndo}
            canRedo={draw.canRedo}
            onTool={draw.setTool}
            onArrowKind={draw.setArrowKind}
            onColor={draw.setColor}
            onHold={draw.setHold}
            onUndo={draw.undo}
            onRedo={draw.redo}
            onRemove={() => finishDraw({ remove: true })}
            onDone={() => finishDraw()}
          />
        )}
        {slowSection && span && !draw.session && (
          <SlowBar
            section={slowSection}
            clipStart={span.start}
            maxLength={Math.min(SLOW_MAX_LENGTH, slowRoom(sections, slowSection, span.start, span.end).max - slowSection.t)}
            onRate={(rate) => setSlows(sections.map((s) => (s.id === slowSection.id ? { ...s, rate } : s)))}
            onLength={(n) => setSlows(sections.map((s) => (s.id === slowSection.id ? { ...s, length: clampSlowLength(sections, slowSection, n, span.start, span.end) } : s)))}
            onStartHere={() => setSlows(sections.map((s) => (s.id === slowSection.id ? slowStartingAt(sections, slowSection, video.currentTime, span.start, span.end) : s)))}
            onRemove={() => {
              setSlows(sections.filter((s) => s.id !== slowSection.id));
              closeSlow();
            }}
            onDone={closeSlow}
          />
        )}
        {!draw.session && !slowSection && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
            <span className="text-callout text-muted-foreground">This clip</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="xs" disabled={!src || !!trim} onClick={() => enterDraw()}>
                  <PenLine />
                  Draw
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                Draw on this frame
                <Kbd>D</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="xs" disabled={!src || !!trim} onClick={openSlowMotion}>
                  <Snail />
                  Slow motion
                </Button>
              </TooltipTrigger>
              <TooltipContent>Play from here at half or quarter speed</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="xs" disabled={!src || !!trim} onClick={startTrim}>
                  <Scissors />
                  Trim…
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                Drag the clip’s start and end on the player
                <Kbd>T</Kbd>
              </TooltipContent>
            </Tooltip>
            {trimmed && !trim && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="xs" onClick={() => void edit.saveLength(clip, 0, 0).then((ok) => ok && playFromStart())}>
                    Reset trim
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{`Back to the report’s clip length (${preRoll} s before, ${postRoll} s after)`}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
        {!draw.session && (
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            <LabelPickerPopover
              trigger={
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-separator transition-[background-color,color,transform] duration-100 hover:bg-fill-1 hover:text-primary active:scale-95"
                  title="Labels"
                >
                  <Tag className="size-3" />
                  {assignedLabels.length === 0 ? "Add labels" : "Edit"}
                </button>
              }
              labels={[...props.labels]}
              assignedAllIds={new Set(props.assigned)}
              onToggle={(labelId, state) => props.labelHandlers.onToggleClip(clip.matchId, clip.eventId, labelId, state)}
              onCreate={props.labelHandlers.onCreate}
              onRename={props.labelHandlers.onRename}
              onRecolor={props.labelHandlers.onRecolor}
              onDelete={props.labelHandlers.onDelete}
              onSetKey={props.labelHandlers.onSetKey}
              onSeedDefaults={props.labelHandlers.onSeedDefaults}
              align="start"
            />
            {assignedLabels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </div>
        )}
        {!draw.session && (
          <ClipNoteField
            fieldRef={noteRef}
            value={note}
            onChange={(v) => {
              setNote(v);
              edit.change(clip, { note: v.trim() || null });
            }}
            onFocus={() => {
              noteAtFocus.current = note.trim();
            }}
            onBlur={() => {
              edit.flush();
              const n = note.trim();
              if (n !== noteAtFocus.current) trackEvent("clip_note_set", { length: n.length, lines: n ? n.split("\n").length : 0, cleared: n === "" });
            }}
          />
        )}
      </div>
    </div>
  );
}
