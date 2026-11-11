import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { periodLabel } from "@scoutable/shared/lib/events";
import type { GameFlow, ScorePoint } from "@scoutable/shared/lib/game-flow";
import type { GameRow } from "@scoutable/shared/lib/game-list";
import type { TimedPlay } from "@scoutable/shared/lib/game-timeline";
import type { Label } from "@scoutable/shared/types/labels";
import { Button } from "@/components/ui/button";
import { riseVariants, useReducedMotionSafe } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { GamePlayRow, type CollectStatus } from "./game-play-row";

const NO_LABELS: readonly Label[] = [];
/** How long one of the list's own scrolls can take: scroll events inside it aren't the coach's. */
const OWN_SCROLL_MS = 700;
/** A scroll event this soon after one of the list's own belongs to the same scroll, however long it runs. */
const OWN_SCROLL_GRACE_MS = 160;
/** The sticky period header covers this much of the list's top. */
const HEADER_PX = 28;
/** The room kept under the current row, so the play to come is in view (the rows' own scroll margin). */
const LOOKAHEAD_PX = 64;

/**
 * The game as a list: each period under its header (its score, how many
 * plays are listed), the plays, and between them what happened around them:
 * timeouts, runs, the end of each period.
 *
 * The current play's row follows playback. The moment the coach scrolls the
 * list themselves, following stops and a "Jump to now" pill points the way
 * back; it resumes when they press it, when they seek (a row, the timeline,
 * a key: `followSignal` changes), or when they scroll the current row back
 * into view.
 */
export function GamePlayList({
  rows,
  hasPlays,
  activeKey,
  playing,
  flow,
  teams,
  labels,
  assignments,
  statusOf,
  targetName,
  labelPickerFor,
  renderLabelPicker,
  followSignal,
  reveal,
  onPlay,
  onAdd,
  onRemove,
  onLabel,
  onMarker,
  onClearFilters,
}: {
  rows: readonly GameRow[];
  /** The game has plays at all (an empty list is then the filters' doing). */
  hasPlays: boolean;
  activeKey: string | null;
  /** Footage is on the stage: the current row is playing, not merely selected. */
  playing: boolean;
  flow: GameFlow;
  teams: { home: string; away: string };
  labels: readonly Label[];
  assignments: ReadonlyMap<string, ReadonlySet<string>>;
  statusOf: (key: string) => CollectStatus;
  targetName: string | null;
  /** The play whose label picker is open, by key. */
  labelPickerFor: string | null;
  renderLabelPicker: (play: TimedPlay) => ReactNode;
  followSignal: number;
  /** A row to bring to the top of the list: the quarter or the marker a key jumped to. */
  reveal: { key: string; nonce: number } | null;
  onPlay: (play: TimedPlay) => void;
  onAdd: (play: TimedPlay, anchor: HTMLElement) => void;
  onRemove: (play: TimedPlay) => void;
  onLabel: (play: TimedPlay) => void;
  onMarker: (row: Exclude<GameRow, { kind: "play" } | { kind: "period" }>) => void;
  onClearFilters: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const [away, setAway] = useState<"up" | "down" | null>(null);
  const ownScrollUntil = useRef(0);
  const reduced = useReducedMotionSafe();

  const pointBy = useMemo(() => new Map<number, ScorePoint>(flow.points.map((p) => [p.eventId, p])), [flow]);
  const leadChanges = useMemo(() => new Set(flow.leadChanges), [flow]);
  const ties = useMemo(() => new Set(flow.ties), [flow]);

  // Each labelled play's labels as one array that stays the same between renders, so its row isn't drawn again.
  const labelsByKey = useMemo(() => {
    const byId = new Map(labels.map((l) => [l.id, l]));
    const out = new Map<string, Label[]>();
    for (const [key, ids] of assignments) {
      const list = [...ids].map((id) => byId.get(id)).filter((l): l is Label => !!l);
      if (list.length > 0) out.set(key, list.sort((a, b) => a.name.localeCompare(b.name)));
    }
    return out;
  }, [labels, assignments]);

  const rowOf = useCallback(
    (key: string) => scrollerRef.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(key)}"]`) ?? null,
    [],
  );

  /** Where the current row is against the list's window: above it, below it, or in view. */
  const whereIsActive = useCallback((): "up" | "down" | null => {
    const scroller = scrollerRef.current;
    const row = activeKey ? rowOf(activeKey) : null;
    if (!scroller || !row) return null;
    const box = scroller.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.bottom < box.top + HEADER_PX) return "up";
    if (r.top > box.bottom) return "down";
    return null;
  }, [activeKey, rowOf]);

  const bringIntoView = useCallback(
    (smooth: boolean) => {
      const scroller = scrollerRef.current;
      const row = activeKey ? rowOf(activeKey) : null;
      if (!scroller || !row) return;
      setAway(null);
      // Clear of the header with room below: the list stays where it is, so a quarter that was just
      // brought to the top keeps its header there when its first play starts.
      const box = scroller.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      if (r.top >= box.top + HEADER_PX && r.bottom <= box.bottom - LOOKAHEAD_PX) return;
      ownScrollUntil.current = performance.now() + OWN_SCROLL_MS;
      row.scrollIntoView({ block: "nearest", behavior: smooth && !reduced ? "smooth" : "auto" });
    },
    [activeKey, rowOf, reduced],
  );

  // Follow playback; when not following, keep the pill pointing the right way.
  useEffect(() => {
    if (following) bringIntoView(true);
    else setAway(whereIsActive());
  }, [activeKey, rows, following, bringIntoView, whereIsActive]);

  // A seek from anywhere means "show me that".
  useEffect(() => {
    setFollowing(true);
  }, [followSignal]);

  // A jump to a quarter or a marker shows that row, whether or not a play is current there yet.
  useEffect(() => {
    if (!reveal) return;
    const row = rowOf(reveal.key);
    if (!row) return;
    ownScrollUntil.current = performance.now() + OWN_SCROLL_MS;
    row.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    // The nonce is the request; the key alone repeats when the same quarter is asked for twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce]);

  function onScroll() {
    const now = performance.now();
    if (now < ownScrollUntil.current) {
      // One of the list's own scrolls, still under way: a long one outlasts the first estimate.
      ownScrollUntil.current = Math.max(ownScrollUntil.current, now + OWN_SCROLL_GRACE_MS);
      return;
    }
    const where = whereIsActive();
    setAway(where);
    // Scrolled away: stop following. Scrolled back to the current row: follow again.
    setFollowing(where === null);
  }

  if (rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
        {hasPlays ? (
          <>
            <p className="text-headline">No plays match</p>
            <p className="text-callout text-muted-foreground">Try another moment, or clear the filters.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilters}>
              Clear filters
            </Button>
          </>
        ) : (
          <>
            <p className="text-headline">No play-by-play</p>
            <p className="text-callout text-muted-foreground">The league recorded no plays for this game.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollerRef} role="list" aria-label="Plays" onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pb-4">
        {rows.map((row) => {
          if (row.kind === "play") {
            const e = row.play.event;
            const point = pointBy.get(e.eventId);
            const active = row.key === activeKey;
            return (
              <GamePlayRow
                key={row.key}
                play={row.play}
                active={active}
                playing={active && playing}
                score={point ? { home: point.home, away: point.away } : null}
                scored={point?.team ?? null}
                note={leadChanges.has(e.eventId) ? "Lead change" : ties.has(e.eventId) && point ? `Tied at ${point.home}` : null}
                labels={labelsByKey.get(row.key) ?? NO_LABELS}
                collect={statusOf(row.key)}
                targetName={targetName}
                labelPicker={labelPickerFor === row.key ? renderLabelPicker(row.play) : null}
                onPlay={onPlay}
                onAdd={onAdd}
                onRemove={onRemove}
                onLabel={onLabel}
              />
            );
          }
          if (row.kind === "period") {
            return (
              <div
                key={row.key}
                data-row-key={row.key}
                className="sticky top-0 z-20 flex h-7 items-center gap-2 bg-background/90 px-3 text-subheadline backdrop-blur-md"
              >
                <span className="font-semibold">{periodLabel(row.period)}</span>
                {row.score && (
                  <span className="nums text-muted-foreground">
                    {row.score.home}–{row.score.away}
                  </span>
                )}
                <span className="ml-auto nums text-muted-foreground">
                  {row.plays} {row.plays === 1 ? "play" : "plays"}
                </span>
              </div>
            );
          }
          return (
            <button
              key={row.key}
              type="button"
              data-row-key={row.key}
              onClick={() => onMarker(row)}
              className={cn(
                "flex h-7 w-full scroll-mt-8 items-center gap-2 px-3 text-subheadline text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 hover:text-foreground active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
                row.kind === "period_end" && "mt-1 mb-2",
              )}
            >
              <span className="h-px flex-1 bg-separator" aria-hidden />
              <span className="shrink-0 nums">{markerText(row, teams)}</span>
              <span className="h-px flex-1 bg-separator" aria-hidden />
            </button>
          );
        })}
      </div>
      <AnimatePresence>
        {!following && away && (
          <motion.div
            key="jump"
            variants={riseVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center"
          >
            <button
              type="button"
              onClick={() => {
                setFollowing(true);
                bringIntoView(true);
              }}
              className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-full bg-material-popover px-3 text-subheadline font-medium shadow-menu outline-none backdrop-blur-xl transition-[background-color,transform] duration-100 hover:bg-fill-2 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-selection"
            >
              {away === "up" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
              Jump to now
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A marker row in words: "Timeout · AIK · 03:58 · 54–51", "Run · AIK 10–0", "Half-time · 41–38". */
export function markerText(row: Exclude<GameRow, { kind: "play" } | { kind: "period" }>, teams: { home: string; away: string }): string {
  const teamName = (n: 1 | 2 | null) => (n === 1 ? teams.home : n === 2 ? teams.away : null);
  if (row.kind === "timeout") {
    const t = row.timeout;
    const score = t.scoreHome !== null && t.scoreAway !== null ? `${t.scoreHome}–${t.scoreAway}` : null;
    return [t.kind === "officials" ? "Officials’ timeout" : "Timeout", teamName(t.teamNumber), t.clock || null, score].filter(Boolean).join(" · ");
  }
  if (row.kind === "run") return `Run · ${teamName(row.run.team)} ${row.run.points}–0`;
  const score = row.score ? `${row.score.home}–${row.score.away}` : null;
  const what = row.final ? "Final score" : row.half ? "Half-time" : `End of ${periodLabel(row.period)}`;
  return [what, score].filter(Boolean).join(" · ");
}
