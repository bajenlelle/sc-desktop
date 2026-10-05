import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMSSd } from "@/components/sync-point-picker";
import type { TipoffSuggestionState } from "@/lib/use-tipoff-suggestion";

const STAGE_LABEL: Record<string, string> = { locate: "step 1 of 3", coarse: "step 2 of 3", fine: "step 3 of 3" };
const SLOW_AFTER_MS = 45_000;

interface Props {
  state: TipoffSuggestionState;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}

/** One line under the sync prompt: what the app found out about this recording's tip-off, and what to do with it. */
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

  if (state.kind === "unavailable") {
    return import.meta.env.DEV ? <p className="text-xs text-muted-foreground">Tip-off suggestion unavailable: {state.reason}</p> : null;
  }
  // Nothing to say once the user has decided: the picker shows the confirmed time after an accept.
  if (state.kind === "idle" || state.kind === "rejected" || state.kind === "accepted" || state.kind === "cancelled" || state.kind === "manual") return null;

  // While the app is still working, the picker below is already usable.
  const meanwhile = (
    <p className="text-xs text-muted-foreground">
      You don't have to wait: scrub to the tip-off below and click{" "}
      <span className="font-medium text-foreground">Set tip-off here</span>.
    </p>
  );

  const shell = (children: React.ReactNode) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      {children}
    </div>
  );

  switch (state.kind) {
    case "fingerprinting":
    case "looking_up":
      return shell(
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-muted-foreground">Checking whether this recording has been imported before…</p>
            {meanwhile}
          </div>
        </>,
      );
    case "detecting":
      return shell(
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-muted-foreground">
              Looking for the tip-off… ({STAGE_LABEL[state.stage] ?? state.stage}){slow ? " This can take a minute for large files." : ""}
            </p>
            {meanwhile}
          </div>
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-7" onClick={onCancel}>
            Cancel
          </Button>
        </>,
      );
    case "hint_found":
      return shell(
        <>
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            Tip-off found from an earlier import of this recording{state.agreement > 1 ? ` (${state.agreement} users agree)` : ""}.
          </span>
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" className="h-7" onClick={onAccept}>
              Use {formatMSSd(state.seconds)}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onReject}>
              Set manually
            </Button>
          </span>
        </>,
      );
    case "suggested":
      return shell(
        <>
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            {state.previewed
              ? `Is this the tip-off? The game clock starts at ${formatMSSd(state.seconds)}.`
              : `Tip-off found: the game clock starts at ${formatMSSd(state.seconds)}.`}
          </span>
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" className="h-7" onClick={onAccept}>
              Use {formatMSSd(state.seconds)}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onReject}>
              Set manually
            </Button>
          </span>
        </>,
      );
    case "starts_after_tipoff":
      return shell(
        <>
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            The recording starts after the tip-off{state.firstClock ? `: the game clock already reads ${state.firstClock} in the first frame` : ""}.
          </span>
          <span className="ml-auto flex gap-2">
            {state.estimateS != null && (
              <Button type="button" size="sm" className="h-7" onClick={onAccept}>
                Use {formatMSSd(state.estimateS)}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onReject}>
              Set manually
            </Button>
          </span>
        </>,
      );
    case "not_found":
    case "failed":
      return shell(<span className="text-muted-foreground">No tip-off found automatically. Scrub to it below.</span>);
    default:
      return null;
  }
}
