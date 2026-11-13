import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Signpost } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  closeImportGuide,
  currentImportGuideStep,
  importGuideTrigger,
  openImportGuide,
  takeImportGuideEvents,
  useImportGuideFacts,
  useImportGuideOpen,
  useImportGuideReady,
  useImportGuideStep,
  useImportGuideView,
  type ImportGuideTrigger,
  type ImportGuideView,
} from "@/lib/import-guide-store";
import { countOwnImports } from "@/lib/matches-db";
import { useReducedMotionSafe } from "@/lib/motion";
import { getImportGuideDone, setImportGuideDone } from "@/lib/prefs";
import {
  IMPORT_GUIDE_STEPS,
  importGuideEntry,
  importGuideStepNumber,
  type ImportGuideStep,
} from "@scoutable/shared/lib/import-guide";

/**
 * The first-import guide on the Import game page: the current step's area
 * stays lit while the rest of the page is washed out, the button to press
 * gets a ring, and a bubble says what to do and why. It follows the page
 * (packages/shared/lib/import-guide.ts) and never blocks it: everything
 * stays clickable, and there is no Next button.
 *
 * The wash and the ring are CSS in index.css, driven by `data-guide-step`
 * here and the `data-tour` attributes in the page.
 */

/** The bubble needs this much free room beside the column to sit in the margin. */
const MARGIN_ROOM = 208;

/** The tall steps: a list or a player the bubble must not push out of view. */
const TALL: readonly ImportGuideStep[] = ["pick", "tipoff"];

/** The button each step rings, first match wins. The same choice is drawn by the CSS in index.css. */
const ACTIONS: Record<ImportGuideStep, readonly string[]> = {
  pick: [],
  video: ['[data-tour="video-pick"]'],
  tipoff: ['[data-tour="tipoff-use"]', '[data-tour="tipoff-set"]'],
  import: ['[data-tour="submit-button"]'],
};

function start(trigger: ImportGuideTrigger) {
  if (openImportGuide(trigger)) trackEvent("import_guide_started", { trigger });
}

/** Skip is for good; Escape only closes the guide for this visit. */
function dismiss(how: "skip" | "escape", userId: string | undefined) {
  trackEvent("import_guide_skipped", { step: currentImportGuideStep(), how });
  if (how === "skip") setImportGuideDone(userId);
  closeImportGuide();
}

function guideCopy(
  step: ImportGuideStep,
  view: ImportGuideView,
  settingQuarters: boolean,
): { title: string; body: string } {
  switch (step) {
    case "pick":
      return {
        title: "Pick the game in your recording",
        body: view.teamView
          ? "Pick the game your video shows. It isn't always your latest one: All games has every team."
          : "Pick the game your video shows. Search by team or date.",
      };
    case "video":
      return {
        title: "Choose the recording",
        body: "Pick the video file of this game from your computer. The next step lines the plays up with it.",
      };
    case "tipoff":
      if (settingQuarters) {
        return {
          title: "Set where the quarters start",
          body: "This recording seems to skip the breaks. Set where each quarter starts, or switch that off if it plays straight through.",
        };
      }
      return {
        title: "Set the tip-off",
        body:
          "Move to the moment the ball goes up for the opening tip, then press Set tip-off here. Every play is timed from this moment." +
          (view.offer ? " Check the frame before you use a suggested time." : ""),
      };
    case "import":
      return view.isUpdate
        ? {
            title: "Update the game",
            body: "Everything is set. Update the game: its plays refresh and your playlists keep working.",
          }
        : {
            title: "Import the game",
            body: "Everything is set. Import the game to start building playlists.",
          };
  }
}

/** Wraps the Import game page's content: starts the guide, reports on it, and tells the CSS where it is. */
export function ImportGuideRoot({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const ready = useImportGuideReady();
  const open = useImportGuideOpen();
  const step = useImportGuideStep();
  const facts = useImportGuideFacts();
  const view = useImportGuideView();
  const reduceMotion = useReducedMotionSafe();
  const rootRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"margin" | "below">("below");

  // A coach who has never imported a game gets the guide without asking.
  useEffect(() => {
    if (!userId || !ready || getImportGuideDone(userId)) return;
    let cancelled = false;
    void countOwnImports()
      .catch(() => null)
      .then((ownImports) => {
        if (cancelled) return;
        if (importGuideEntry({ done: false, ownImports }) === "auto") start("auto");
        else if (ownImports) setImportGuideDone(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, ready]);

  // Report each step once as the page moves; the import ends the guide.
  useEffect(() => {
    if (!open) return;
    for (const e of takeImportGuideEvents()) {
      if (e.event === "import_guide_completed") {
        trackEvent(e.event, { seconds: e.seconds, trigger: importGuideTrigger() });
        setImportGuideDone(userId);
        closeImportGuide();
      } else {
        const { event, ...props } = e;
        trackEvent(event, props);
      }
    }
  }, [open, facts, userId]);

  // Escape closes the bubble on screen, unless something else took the key
  // (Radix layers prevent it in capture) or the coach is typing.
  useEffect(() => {
    if (!step) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      dismiss("escape", userId);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, userId]);

  // The tall steps put their bubble in the margin beside the column when the
  // window leaves room for it; otherwise it hangs below like the others.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    let scroller: HTMLElement | null = root.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) return;
    const page = scroller;
    const measure = () => {
      const column = root.querySelector<HTMLElement>("[data-tour]") ?? root;
      const room = page.getBoundingClientRect().left + page.clientWidth - column.getBoundingClientRect().right;
      setSide(room >= MARGIN_ROOM ? "margin" : "below");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    return () => observer.disconnect();
  }, [open, ready]);

  // Bring the step into view: the bubble, or the ringed button when the bubble
  // rides in the margin. Again if the lit area grows (a list arrives, a video
  // loads), but only until the coach touches the page: after that it is theirs.
  useEffect(() => {
    const root = rootRef.current;
    if (!step || !root) return;
    const inMargin = side === "margin" && TALL.includes(step);
    let timer = 0;
    const reveal = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const target = inMargin
          ? ACTIONS[step].map((selector) => root.querySelector<HTMLElement>(selector)).find(Boolean)
          : root.querySelector<HTMLElement>("[data-guide-bubble]");
        target?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
      }, 350);
    };
    const observer = new ResizeObserver(reveal);
    const area = root.querySelector("[data-guide-bubble]")?.closest("[data-tour]");
    if (area) observer.observe(area);
    else reveal();
    const stop = () => observer.disconnect();
    const touches = ["pointerdown", "keydown", "wheel"] as const;
    for (const type of touches) window.addEventListener(type, stop, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      for (const type of touches) window.removeEventListener(type, stop, { capture: true });
    };
  }, [step, side, reduceMotion]);

  const copy = step ? guideCopy(step, view, !!facts?.settingQuarters) : null;

  return (
    <div
      ref={rootRef}
      className="import-guide-root"
      data-guide-open={open ? "" : undefined}
      data-guide-step={step ?? undefined}
      data-guide-side={step ? side : undefined}
    >
      {/* One live region that outlasts the bubbles, so each step is announced without moving focus. */}
      <p role="status" aria-atomic="true" className="sr-only">
        {step && copy ? `Import guide, step ${importGuideStepNumber(step)} of ${IMPORT_GUIDE_STEPS.length}. ${copy.title}. ${copy.body}` : ""}
      </p>
      {children}
    </div>
  );
}

/** Where a bubble hangs: each lit area of the page holds one slot. */
const SLOTS = {
  pick: ["pick"],
  video: ["video", "tipoff"],
  submit: ["import"],
} as const satisfies Record<string, readonly ImportGuideStep[]>;


const ALIGN: Record<ImportGuideStep, "start" | "center" | "end"> = {
  pick: "center",
  video: "center",
  tipoff: "start",
  import: "end",
};

/**
 * The guide's bubble for one lit area. Put it first inside the element that
 * carries the area's `data-tour`: it is positioned against that element, so
 * it follows it as the page's parts grow, shrink and swap.
 */
export function ImportGuideBubble({ at }: { at: keyof typeof SLOTS }) {
  const { user } = useAuth();
  const step = useImportGuideStep();
  const view = useImportGuideView();
  const facts = useImportGuideFacts();
  if (!step || !(SLOTS[at] as readonly ImportGuideStep[]).includes(step)) return null;

  const copy = guideCopy(step, view, !!facts?.settingQuarters);
  return (
    <div
      key={step}
      className="import-guide-rail"
      data-tall={TALL.includes(step) ? "" : undefined}
      data-align={ALIGN[step]}
    >
      <aside data-guide-bubble aria-label="Import guide" className="import-guide-bubble">
        <p className="text-sm font-semibold text-foreground">{copy.title}</p>
        <p className="mt-1 text-callout text-muted-foreground">{copy.body}</p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="text-callout text-muted-foreground nums">
            Step {importGuideStepNumber(step)} of {IMPORT_GUIDE_STEPS.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="-mr-1.5 text-muted-foreground"
            onClick={() => dismiss("skip", user?.id)}
          >
            {importGuideTrigger() === "manual" ? "Hide guide" : "Skip guide"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

/** The toolbar's way back to the guide, for anyone, whenever it is not showing. */
export function ImportGuideLauncher() {
  const ready = useImportGuideReady();
  const open = useImportGuideOpen();
  if (!ready || open) return null;
  return (
    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => start("manual")}>
      <Signpost />
      Show guide
    </Button>
  );
}
