import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { describePlay, formatGameClock } from "@scoutable/shared/lib/events";
import { footageStartFromCuts, q1Baskets, tipoffFromBasket, type BasketAnchor } from "@scoutable/shared/lib/sync-anchor";
import type { AnchorCopy } from "@/components/sync-point-picker";
import { Button } from "@/components/ui/button";
import { quietControl } from "@/components/ui/filter-button";
import { trackEvent } from "@/lib/analytics";
import { isLocalPath } from "@/lib/stream";
import { cn } from "@/lib/utils";
import { findCuts } from "@/lib/video-frames";
import type { PlayByPlayEvent } from "@/types/match";

/** The picker's words while the first basket is set in the tip-off's place. */
const BASKET_COPY: AnchorCopy = {
  title: "Set the first basket you can see",
  instruction: "Find the frame where the ball goes in, then set it.",
  button: "Set basket here",
  confirmed: "Basket set at",
};

/** How far before a basket the picker is put, so the play leading to it is seen. */
const LEAD_S = 4;

type Surface = "import" | "game_page";

/**
 * Syncing on the first basket the coach can see, when the tip-off isn't in
 * the video (lib/sync-anchor.ts): the tip-off picker sets the basket, and
 * the tip-off is worked out from it, before the recording if need be. The
 * coach steps to a later basket when the first isn't in the footage either.
 * Setting it also looks for a jump into the game between the tip-off and the
 * basket (a recording that holds the warm-up and loses the tip-off in a
 * dropped stream): the game's footage starts there.
 */
export function useFirstBasket({
  events,
  tipoffRealWorldTime,
  videoPath,
  surface,
  tipoffEstimate,
  seek,
}: {
  events: readonly PlayByPlayEvent[];
  /** The tip-off on the wall clock; null when the game has none to work from. */
  tipoffRealWorldTime: string | null;
  videoPath: string | null;
  surface: Surface;
  /** Where the tip-off is thought to be in the video (set, or suggested), to put the picker by the basket; null when nothing is. */
  tipoffEstimate: number | null;
  /** Puts the picker at a second, paused. */
  seek: (seconds: number) => void;
}) {
  const baskets = useMemo(() => (tipoffRealWorldTime ? q1Baskets(events, tipoffRealWorldTime) : []), [events, tipoffRealWorldTime]);
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const basket: BasketAnchor<PlayByPlayEvent> | null = active ? (baskets[index] ?? null) : null;

  // Another video starts at the tip-off again.
  useEffect(() => {
    setActive(false);
    setIndex(0);
  }, [videoPath]);

  const estimateRef = useRef(tipoffEstimate);
  useEffect(() => {
    estimateRef.current = tipoffEstimate;
  });
  const goTo = useCallback(
    (i: number) => {
      setIndex(i);
      const b = baskets[i];
      const tip = estimateRef.current;
      if (b && tip !== null) seek(Math.max(0, tip + b.afterTipoffS - LEAD_S));
    },
    [baskets, seek],
  );

  const open = useCallback(
    (from: "link" | "strip") => {
      setActive(true);
      goTo(0);
      trackEvent("sync_first_basket_opened", { surface, from, baskets: baskets.length });
    },
    [goTo, surface, baskets.length],
  );

  /** Where the game's footage starts, from a hard cut between the tip-off and the basket; null when the footage runs unbroken. */
  const footageStartFor = useCallback(
    async (tip: number, basketSeconds: number): Promise<number | null> => {
      if (!videoPath || !isLocalPath(videoPath)) return null;
      const from = Math.max(0, tip);
      if (basketSeconds - from < 4) return null;
      try {
        return footageStartFromCuts(await findCuts(videoPath, from, basketSeconds - from), tip, basketSeconds);
      } catch {
        // No cuts to read: the footage is taken to run unbroken, as it always was.
        return null;
      }
    },
    [videoPath],
  );

  /** The basket set at `seconds`: the tip-off it gives, and where the game's footage starts. */
  const set = useCallback(
    async (seconds: number): Promise<{ tip: number; footageStart: number | null } | null> => {
      if (!basket) return null;
      const tip = tipoffFromBasket(seconds, basket);
      const footageStart = await footageStartFor(tip, seconds);
      trackEvent("sync_first_basket_set", {
        surface,
        basket: index + 1,
        after_tipoff_s: Math.round(basket.afterTipoffS),
        tipoff_s: Math.round(tip * 10) / 10,
        footage_start: footageStart !== null,
      });
      return { tip, footageStart };
    },
    [basket, footageStartFor, surface, index],
  );

  return {
    /** Whether the game has a basket to sync on: the link is offered only then. */
    available: baskets.length > 0,
    active: active && basket !== null,
    basket,
    index,
    count: baskets.length,
    open,
    close: () => setActive(false),
    next: () => goTo(Math.min(baskets.length - 1, index + 1)),
    previous: () => goTo(Math.max(0, index - 1)),
    copy: BASKET_COPY,
    /** The basket's place in the video by a tip-off already set; null when none is. */
    confirmedFor: (tip: number | null) => (tip === null || !basket ? null : tip + basket.afterTipoffS),
    set,
  };
}

export type FirstBasket = ReturnType<typeof useFirstBasket>;

/**
 * Beside the picker's set button, where the coach decides: "Tip-off not in
 * the video?" while the tip-off is set, "Use the tip-off" while the first
 * basket is. None when the game has no basket to sync on.
 */
export function FirstBasketSwitch({ fb }: { fb: FirstBasket }) {
  if (!fb.available) return null;
  return fb.active ? (
    <Button type="button" variant="ghost" data-sync="tipoff-link" onClick={fb.close}>
      Use the tip-off
    </Button>
  ) : (
    <Button type="button" variant="ghost" data-sync="first-basket-link" title="Set the first basket you can see instead" onClick={() => fb.open("link")}>
      Tip-off not in the video?
    </Button>
  );
}

/**
 * The basket to find, in the suggestion's place above the picker: what goes
 * up on the scoreboard, who scores and when, and steps to the next basket
 * when this one isn't in the footage either.
 */
export function FirstBasketPanel({ fb }: { fb: FirstBasket }) {
  const b = fb.basket;
  if (!b) return null;
  const e = b.event;
  // "9:39", not the feed's "09:39".
  const clock = e.gameClockTime ? formatGameClock(e.gameClockTime).replace(/^0(\d:)/, "$1") : null;
  return (
    <div className="pb-3">
      <div data-sync="first-basket" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-fill-1 px-3 py-2.5 text-sm">
        {b.score && (
          <span data-sync="first-basket-score" className="shrink-0 rounded-md bg-background px-1.5 py-0.5 font-semibold nums shadow-xs ring-1 ring-separator">
            {b.score.home}–{b.score.away}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-foreground">{describePlay(e)}</span>
          <span className="truncate text-callout text-muted-foreground nums">
            {clock ? `Q1 ${clock} · ` : ""}
            {Math.round(b.afterTipoffS)} s after the tip-off
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button type="button" aria-label="Earlier basket" disabled={fb.index === 0} className={cn(quietControl, "size-7 justify-center px-0 disabled:opacity-40")} onClick={fb.previous}>
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-12 text-center text-callout text-muted-foreground nums">
            {fb.index + 1} of {fb.count}
          </span>
          <button
            type="button"
            aria-label="Later basket"
            title="Not in the video either? The next one"
            disabled={fb.index >= fb.count - 1}
            className={cn(quietControl, "size-7 justify-center px-0 disabled:opacity-40")}
            onClick={fb.next}
          >
            <ChevronRight className="size-4" />
          </button>
        </span>
      </div>
    </div>
  );
}
