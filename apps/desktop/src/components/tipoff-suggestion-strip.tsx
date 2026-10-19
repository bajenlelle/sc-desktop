import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AutoHeight } from "@/components/ui/auto-height";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatMSSd } from "@/components/sync-point-picker";
import { fadeVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { TipoffSuggestionState } from "@/lib/use-tipoff-suggestion";

const STAGE_STEP: Record<string, number> = { locate: 1, coarse: 2, narrow: 2, fine: 3 };
const SLOW_AFTER_MS = 45_000;

interface Props {
  state: TipoffSuggestionState;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}

/** True while the strip offers a tip-off the user can take in one press. */
export function isSuggestionPending(state: TipoffSuggestionState): boolean {
  return state.kind === "hint_found" || state.kind === "suggested" || state.kind === "starts_after_tipoff";
}

/**
 * What the app found out about this recording's tip-off, in one strip above
 * the picker. It grows in and out with a spring and its states cross-fade in
 * place, so the footage below moves smoothly instead of jumping.
 */
export function TipoffSuggestionStrip({ state, onAccept, onReject, onCancel }: Props) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (state.kind !== "detecting") {
      setSlow(false);
      return;
    }
    const remaining = Math.max(0, SLOW_AFTER_MS - (Date.now() - state.startedAt));
    const id = window.setTimeout(() => setSlow(true), remaining);
    return () => window.clearTimeout(id);
  }, [state]);

  const content = render();

  return (
    <AutoHeight>
      <AnimatePresence mode="popLayout" initial={false}>
        {content && (
          <motion.div key={content.key} variants={fadeVariants} initial="hidden" animate="visible" exit="exit" className="pb-3">
            {content.node}
          </motion.div>
        )}
      </AnimatePresence>
    </AutoHeight>
  );

  function shell(children: React.ReactNode, tone: "quiet" | "offer" = "quiet") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-sm",
          tone === "offer" ? "bg-primary/8 ring-1 ring-primary/25" : "bg-fill-1",
        )}
      >
        {children}
      </div>
    );
  }

  function offer(text: string, seconds: number | null) {
    return shell(
      <>
        <Sparkles className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">{text}</span>
        <span className="flex shrink-0 gap-2">
          {seconds !== null && (
            <Button type="button" size="sm" onClick={onAccept}>
              Use <span className="nums">{formatMSSd(seconds)}</span>
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onReject}>
            Set manually
          </Button>
        </span>
      </>,
      "offer",
    );
  }

  function render(): { key: string; node: React.ReactNode } | null {
    // While the app is still working, the picker below is already usable.
    const meanwhile = (
      <p className="text-callout text-muted-foreground">
        You don&apos;t have to wait: scrub to the tip-off below and set it yourself.
      </p>
    );

    switch (state.kind) {
      case "unavailable":
        return import.meta.env.DEV
          ? { key: "unavailable", node: <p className="text-xs text-muted-foreground">Tip-off suggestion unavailable: {state.reason}</p> }
          : null;
      case "fingerprinting":
      case "looking_up":
        return {
          key: "checking",
          node: shell(
            <>
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p>Checking whether this recording has been imported before…</p>
                {meanwhile}
              </div>
            </>,
          ),
        };
      case "detecting": {
        const step = STAGE_STEP[state.stage] ?? 1;
        return {
          key: "detecting",
          node: shell(
            <>
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p>Looking for the tip-off</p>
                  <ProgressBar percent={(step / 3) * 100 - 10} className="w-16" />
                  <span className="text-callout text-muted-foreground nums">step {step} of 3</span>
                </div>
                {meanwhile}
                <AnimatePresence initial={false}>
                  {slow && (
                    <motion.p
                      variants={fadeVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="text-callout text-muted-foreground"
                    >
                      This can take a minute for large files.
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
              <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={onCancel}>
                Cancel
              </Button>
            </>,
          ),
        };
      }
      case "hint_found":
        return {
          key: "hint_found",
          node: offer(
            `Tip-off found from an earlier import of this recording${state.agreement > 1 ? ` (${state.agreement} users agree)` : ""}.`,
            state.seconds,
          ),
        };
      case "suggested":
        return {
          key: "suggested",
          node: offer(
            state.previewed
              ? `Is this the tip-off? The game clock starts at ${formatMSSd(state.seconds)}.`
              : `Tip-off found: the game clock starts at ${formatMSSd(state.seconds)}.`,
            state.seconds,
          ),
        };
      case "starts_after_tipoff":
        return {
          key: "starts_after_tipoff",
          node: offer(
            `The recording starts after the tip-off${state.firstClock ? `: the game clock already reads ${state.firstClock} in the first frame` : ""}.`,
            state.estimateS,
          ),
        };
      case "not_found":
      case "failed":
        return {
          key: "none",
          node: shell(<span className="text-muted-foreground">No tip-off found automatically. Scrub to it below.</span>),
        };
      // Nothing to say once the user has decided: the picker shows the confirmed time.
      default:
        return null;
    }
  }
}
