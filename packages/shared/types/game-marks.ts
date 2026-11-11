/**
 * A game's marks: what the league's play-by-play records besides the plays
 * that become clips. The import keeps only clippable plays, so the timeouts
 * and each period's start and end live here, on the game
 * (`matches.game_marks`). See lib/game-marks.ts.
 */

export interface GameTimeout {
  /** The feed's action number: where the timeout sits among the plays. */
  eventId: number;
  /** Global period: OT1 = 5. */
  period: number;
  /** The game clock when it was called, "MM:SS". */
  clock: string;
  /** When it was called, ISO UTC. */
  realWorldTime: string;
  /** When the clock next started, ISO UTC. Absent when the feed doesn't say. */
  resumeRealWorldTime?: string;
  /** A team's own timeout, or one the officials called. */
  kind: "team" | "officials";
  /** 1 = home, 2 = away; null for the officials'. */
  teamNumber: 1 | 2 | null;
  scoreHome: number | null;
  scoreAway: number | null;
}

export interface GamePeriodBounds {
  startRealWorldTime?: string;
  endRealWorldTime?: string;
}

/** What the marks were read against: a re-import that moves the plays makes them stale. */
export interface GameMarksBasis {
  plays: number;
  first: string;
  last: string;
}

export interface GameMarks {
  v: 1;
  /** "genius": read from the league feed. "events": from timeout rows a feed keeps among its plays. */
  source: "genius" | "events";
  /** Keyed by global period ("1" … "4", "5" = OT1). */
  periods: Record<string, GamePeriodBounds>;
  /** In game order. */
  timeouts: GameTimeout[];
  basis?: GameMarksBasis;
}
