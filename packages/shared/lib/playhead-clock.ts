/**
 * The playhead a scrubber draws while a video plays.
 *
 * Measured in the desktop app (WKWebView, 2026-11-26): after a clip starts,
 * no new frame reaches the screen for 0.25–0.35 s while currentTime runs on
 * ahead, then frames flow from just after the start and currentTime stands
 * still until they catch up. A scrubber that draws currentTime runs, stops
 * and goes on; one that draws the frames stands still for the first third
 * of a second. Neither feels like the press started anything.
 *
 * The clock chases the picture instead: it moves from the press, at the
 * playback rate when level with the picture, slower (never under 0.3×) the
 * further it is ahead, faster (up to 1.5×) when it is behind, so it never
 * stops or steps back and lands on the picture within about a second. Half
 * a second ahead it stops (a real stall); a picture more than half a second
 * ahead is jumped to.
 *
 * Feed it the presented frames (requestVideoFrameCallback's media time),
 * or currentTime where frames aren't reported, and reset it from where the
 * video is on a seek, a new clip or playing again after a pause.
 */
export class PlayheadClock {
  private shown = 0;
  private last: number | null = null;
  private anchor: { t: number; at: number } | null = null;
  private start = 0;

  /** Where the video is, at `now` (ms): a seek, a new clip, playback starting again. */
  reset(t: number, now: number): void {
    this.shown = t;
    this.start = t;
    this.last = now;
    this.anchor = null;
  }

  /** A presented frame's time `t`, seen at `at` (ms). The same time again is not a new frame. */
  observe(t: number, at: number): void {
    if (this.anchor && this.anchor.t === t) return;
    this.anchor = { t, at };
  }

  /** The playhead at `now` (ms), playing at `rate`. */
  advance(now: number, rate: number): number {
    const dt = this.last === null ? 0 : Math.max(0, now - this.last) / 1000;
    this.last = now;
    // Where the picture is: the last frame carried on a little (frames come 25–60 times a second), or, before
    // the first frame, the start.
    const picture = this.anchor
      ? this.anchor.t + Math.min(Math.max(now - this.anchor.at, 0) / 1000, 0.1) * rate
      : this.start;
    const gap = this.shown - picture;
    if (gap < -0.5) {
      this.shown = picture;
      return this.shown;
    }
    const pace = gap > 0.5 ? 0 : gap > 0 ? Math.max(0.3, 1 - gap / 0.4) : Math.min(1.5, 1 - gap / 0.2);
    this.shown += dt * rate * pace;
    return this.shown;
  }
}
