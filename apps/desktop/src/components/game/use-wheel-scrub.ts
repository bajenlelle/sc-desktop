import { useEffect, useRef, type RefObject } from "react";
import { IDLE_WHEEL, wheelScrub } from "@scoutable/shared/lib/wheel-scrub";

/**
 * How long after its last event a swipe counts as over. Longer than the gap
 * that separates two gestures' directions: fingers that hesitate on the
 * trackpad while looking for a moment are still scrubbing, and the video
 * shouldn't start up under them.
 */
const SWIPE_REST_MS = 400;

/**
 * A sideways swipe on a trackpad, or a mouse wheel turned with Shift, over an
 * element scrubs: `onScrub` gets each event's pixels (positive is later) and
 * `onEnd` fires once the fingers and their momentum have rested a moment. A scroll up
 * or down is left to the page (packages/shared/lib/wheel-scrub.ts decides).
 * The listener is the element's own and not passive: a scrub has to keep the
 * page from taking the same swipe.
 */
export function useWheelScrub(
  ref: RefObject<HTMLElement | null>,
  { enabled, onScrub, onEnd }: { enabled: boolean; onScrub: (px: number) => void; onEnd: () => void },
) {
  const latest = useRef({ onScrub, onEnd });
  latest.current = { onScrub, onEnd };

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let gesture = IDLE_WHEEL;
    let scrubbing = false;
    let timer = 0;
    const end = () => {
      timer = 0;
      if (!scrubbing) return;
      scrubbing = false;
      latest.current.onEnd();
    };
    const onWheel = (e: WheelEvent) => {
      const next = wheelScrub(gesture, e, performance.now());
      gesture = next.gesture;
      if (next.px === null) return;
      e.preventDefault();
      scrubbing = true;
      latest.current.onScrub(next.px);
      window.clearTimeout(timer);
      timer = window.setTimeout(end, SWIPE_REST_MS);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.clearTimeout(timer);
      end();
    };
  }, [ref, enabled]);
}
