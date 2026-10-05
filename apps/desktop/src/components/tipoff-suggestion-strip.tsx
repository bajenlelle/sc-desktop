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

  if (state.kind === "idle" || state.kind === "unavailable" || state.kind === "rejected") return null;

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
          <span className="text-muted-foreground">Checking whether this recording has been imported before…</span>
        </>,
      );
    case "detecting":
      return shell(
        <>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">
            Looking for the tip-off… ({STAGE_LABEL[state.stage] ?? state.stage}){slow ? " This can take a minute for large files." : ""}
          </span>
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
            Tip-off found from an earlier import of this recording{state.agreement > 1 ? ` (${state.agreement} users agree)` : ""} — check it.
          </span>
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" className="h-7" onClick={onAccept}>
              Use {formatMSSd(state.seconds)}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onReject}>
              Not right
            </Button>
          </span>
        </>,
      );
    case "suggested":
      return shell(
        <>
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>Is this the tip-off? The game clock starts at {formatMSSd(state.seconds)}.</span>
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" className="h-7" onClick={onAccept}>
              Yes, use it
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onReject}>
              Adjust manually
            </Button>
          </span>
        </>,
      );
    case "starts_after_tipoff":
      return shell(
        <>
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span>
            The recording seems to start after the tip-off{state.firstClock ? ` — the game clock reads ${state.firstClock} at the start` : ""}.
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
      return shell(<span className="text-muted-foreground">Couldn't find the tip-off automatically — scrub to it below.</span>);
    default:
      return null;
  }
}
