/**
 * The first-import guide's live state: a tiny external store like
 * playlist-browser-store.ts, so the Import game page (which knows what is
 * picked), the guide drawn around it and the toolbar's "Show guide" agree
 * without a provider. The page publishes what it knows; the step is read
 * from that, never kept (packages/shared/lib/import-guide.ts).
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  importGuideEvents,
  importGuideStep,
  startImportGuideRun,
  type ImportGuideEvent,
  type ImportGuideFacts,
  type ImportGuideRun,
  type ImportGuideStep,
  type ImportGuideTrigger,
} from "@scoutable/shared/lib/import-guide";

/** What the bubble's wording depends on, beyond the step. */
export interface ImportGuideView {
  /** Step 1 lists the coach's own team's games, with All games one tab away. */
  teamView: boolean;
  /** A suggested tip-off is on offer above the player. */
  offer: boolean;
  /** The game is already in the library: importing updates it. */
  isUpdate: boolean;
}

const NO_VIEW: ImportGuideView = { teamView: false, offer: false, isUpdate: false };

let facts: ImportGuideFacts | null = null;
let view: ImportGuideView = NO_VIEW;
let run: ImportGuideRun | null = null;

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

const sameKeys = <T extends object>(a: T, b: T) =>
  (Object.keys(a) as (keyof T)[]).every((k) => a[k] === b[k]);

/** The Import game page says what it looks like now. Called on every change. */
function publish(nextFacts: ImportGuideFacts, nextView: ImportGuideView) {
  const changed = !facts || !sameKeys(facts, nextFacts) || !sameKeys(view, nextView);
  if (!changed) return;
  facts = nextFacts;
  view = nextView;
  emit();
}

/** The Import game page is gone: the guide goes with it. */
function retire() {
  if (!facts && !run) return;
  facts = null;
  view = NO_VIEW;
  run = null;
  emit();
}

/** For the Import game page: keeps the store in step with it while mounted. */
export function usePublishImportGuide(nextFacts: ImportGuideFacts, nextView: ImportGuideView) {
  useEffect(() => {
    publish(nextFacts, nextView);
    // Each field is listed, not the objects: a fresh object with the same values is no change.
  }, [
    nextFacts.ready,
    nextFacts.hasGame,
    nextFacts.hasVideo,
    nextFacts.hasTipoff,
    nextFacts.settingQuarters,
    nextFacts.blocked,
    nextFacts.imported,
    nextView.teamView,
    nextView.offer,
    nextView.isUpdate,
  ]);
  useEffect(() => retire, []);
}

/** Starts a showing of the guide. False when it is already showing. */
export function openImportGuide(how: ImportGuideTrigger): boolean {
  if (run) return false;
  run = startImportGuideRun(Date.now(), how);
  emit();
  return true;
}

export function closeImportGuide() {
  if (!run) return;
  run = null;
  emit();
}

/** How the showing guide was started, or null when it is not showing. */
export function importGuideTrigger(): ImportGuideTrigger | null {
  return run?.trigger ?? null;
}

/** The step on screen right now, for a handler that needs it once. */
export function currentImportGuideStep(): ImportGuideStep | null {
  return run && facts ? importGuideStep(facts) : null;
}

/** What to report since the last call, as the page stands now. */
export function takeImportGuideEvents(): ImportGuideEvent[] {
  if (!run || !facts) return [];
  const next = importGuideEvents(run, facts, Date.now());
  // No emit: the run is bookkeeping, nothing drawn depends on it.
  run = next.run;
  return next.events;
}

/** The Import game page has drawn its steps. */
export function useImportGuideReady(): boolean {
  return useSyncExternalStore(subscribe, () => !!facts?.ready, () => false);
}

/** The guide is showing (it may be stepping aside for a dialog). */
export function useImportGuideOpen(): boolean {
  return useSyncExternalStore(subscribe, () => run !== null, () => false);
}

/** The step the guide points at, or null when it is closed or stepping aside. */
export function useImportGuideStep(): ImportGuideStep | null {
  return useSyncExternalStore(subscribe, currentImportGuideStep, () => null);
}

export function useImportGuideView(): ImportGuideView {
  return useSyncExternalStore(subscribe, () => view, () => NO_VIEW);
}

/** Changes whenever the page publishes, so an effect can report on it. */
export function useImportGuideFacts(): ImportGuideFacts | null {
  return useSyncExternalStore(subscribe, () => facts, () => null);
}
