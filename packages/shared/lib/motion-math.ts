/**
 * The arithmetic behind fluid interactions, in the form Apple ships it
 * (Designing Fluid Interfaces, WWDC 2018), so the desktop's drag, scrub and
 * flick code can share one tested copy.
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Where a flick would come to rest on its own: the exponential-decay
 * projection UIScrollView uses, not the physics-textbook v²/2a.
 * `velocity` in px/s; `decelerationRate` 0.998 feels like normal scrolling,
 * 0.99 is snappier.
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Soft resistance past a boundary: the further past it, the less the
 * element follows. `overshoot` in px, `dimension` the size of the area the
 * element lives in, `constant` 0.55 matches UIScrollView.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const magnitude = Math.abs(overshoot);
  const resisted = (magnitude * dimension * constant) / (dimension + constant * magnitude);
  return Math.sign(overshoot) * resisted;
}

export interface MotionSample {
  /** Timestamp in ms. */
  t: number;
  /** Position in px. */
  y: number;
}

/**
 * Release velocity (px/s) from the last `windowMs` of pointer samples.
 * Returns 0 when there is too little history to say.
 */
export function velocityFromSamples(samples: readonly MotionSample[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t > windowMs) break;
    first = samples[i];
  }
  const dt = last.t - first.t;
  if (dt <= 0) return 0;
  return ((last.y - first.y) / dt) * 1000;
}
