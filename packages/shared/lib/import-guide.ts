/**
 * The first-import guide on the desktop's Import game page: which step the
 * page is on, read from the page's own state and never from history, and
 * what to report as a coach moves through it. The copy and the drawing live
 * in the desktop app.
 */

/** What the import page says about itself. */
export interface ImportGuideFacts {
  /** The page has drawn its steps (its leagues have loaded). */
  ready: boolean;
  /** A game is picked and its play-by-play has arrived. */
  hasGame: boolean;
  /** A video file is chosen. */
  hasVideo: boolean;
  /** The tip-off is set. */
  hasTipoff: boolean;
  /** The picker has moved on to a later quarter, in a video that skips the breaks. */
  settingQuarters: boolean;
  /** A dialog, the import's progress or its result covers the page. */
  blocked: boolean;
  /** The game is imported. */
  imported: boolean;
}

export const IMPORT_GUIDE_STEPS = ["pick", "video", "tipoff", "import"] as const;
export type ImportGuideStep = (typeof IMPORT_GUIDE_STEPS)[number];

/** A step's place in the guide, counted from 1. */
export function importGuideStepNumber(step: ImportGuideStep): number {
  return IMPORT_GUIDE_STEPS.indexOf(step) + 1;
}

/** How far the page has come, whether or not anything covers it. */
function reached(facts: ImportGuideFacts): ImportGuideStep {
  if (!facts.hasGame) return "pick";
  if (!facts.hasVideo) return "video";
  if (!facts.hasTipoff || facts.settingQuarters) return "tipoff";
  return "import";
}

/** The step to point at, or null while there is nothing to point at. */
export function importGuideStep(facts: ImportGuideFacts): ImportGuideStep | null {
  if (!facts.ready || facts.blocked || facts.imported) return null;
  return reached(facts);
}

/** One showing of the guide, from its start to a skip or the import. Times are in ms. */
export interface ImportGuideRun {
  startedAt: number;
  /** When each step was first shown. */
  shownAt: Partial<Record<ImportGuideStep, number>>;
  completed: ImportGuideStep[];
  done: boolean;
}

export type ImportGuideEvent =
  | { event: "import_guide_step_shown"; step: ImportGuideStep; n: number }
  | { event: "import_guide_step_completed"; step: ImportGuideStep; n: number; seconds: number }
  | { event: "import_guide_completed"; seconds: number };

export function startImportGuideRun(now: number): ImportGuideRun {
  return { startedAt: now, shownAt: {}, completed: [], done: false };
}

const seconds = (from: number, to: number) => Math.round((to - from) / 1000);

/**
 * What to report now that the page looks like `facts`. A step is shown once
 * and completed once per run: going back and coming forward again is quiet,
 * and a step the guide never showed is never reported completed.
 */
export function importGuideEvents(
  run: ImportGuideRun,
  facts: ImportGuideFacts,
  now: number,
): { run: ImportGuideRun; events: ImportGuideEvent[] } {
  if (run.done || !facts.ready) return { run, events: [] };

  const events: ImportGuideEvent[] = [];
  const shownAt = { ...run.shownAt };
  const completed = [...run.completed];
  const position = facts.imported ? IMPORT_GUIDE_STEPS.length : IMPORT_GUIDE_STEPS.indexOf(reached(facts));

  for (const step of IMPORT_GUIDE_STEPS.slice(0, position)) {
    const at = shownAt[step];
    if (at === undefined || completed.includes(step)) continue;
    completed.push(step);
    events.push({
      event: "import_guide_step_completed",
      step,
      n: importGuideStepNumber(step),
      seconds: seconds(at, now),
    });
  }

  if (facts.imported) {
    events.push({ event: "import_guide_completed", seconds: seconds(run.startedAt, now) });
    return { run: { ...run, shownAt, completed, done: true }, events };
  }

  const step = importGuideStep(facts);
  if (step && shownAt[step] === undefined) {
    shownAt[step] = now;
    events.push({ event: "import_guide_step_shown", step, n: importGuideStepNumber(step) });
  }

  return { run: { ...run, shownAt, completed }, events };
}

/**
 * Whether the guide starts by itself: only for a coach who has never
 * imported a game and has not skipped or finished it. A count that could
 * not be read starts nothing.
 */
export function importGuideEntry(input: { done: boolean; ownImports: number | null }): "auto" | null {
  return !input.done && input.ownImports === 0 ? "auto" : null;
}
