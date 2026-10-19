import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2 } from "lucide-react";
import { dialogVariants, scrimVariants, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Where the save is: running, or finished and about to hand over to the result. */
export type SavePhase = "saving" | "done";

type StepState = "done" | "active" | "pending";

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={springs.settle}
        className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white"
      >
        <Check className="size-3" strokeWidth={3} />
      </motion.span>
    );
  }
  if (state === "active") return <Loader2 className="size-4 animate-spin text-primary" />;
  return <span className="size-1.5 rounded-full bg-fill-4" />;
}

/**
 * The import's progress while the game is saved: each step reflects real
 * work (the play-by-play is already in hand, the save is the one wait),
 * never a timer. It sits where the confirmation dialog will appear and
 * hands over to it.
 */
export function GeneratingSession({
  phase,
  eventCount,
  isUpdate,
}: {
  phase: SavePhase | null;
  eventCount: number;
  isUpdate: boolean;
}) {
  const steps: { label: string; state: StepState }[] = [
    { label: `Game data: ${eventCount} event${eventCount === 1 ? "" : "s"}`, state: "done" },
    { label: isUpdate ? "Updating your library" : "Saving to your library", state: phase === "saving" ? "active" : "done" },
    { label: "Ready to scout", state: phase === "done" ? "done" : "pending" },
  ];

  return (
    <AnimatePresence>
      {phase && (
        <div key="generating" className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            variants={scrimVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 bg-black/40"
          />
          <motion.div
            variants={dialogVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            role="status"
            aria-live="polite"
            className="relative w-full max-w-xs rounded-window bg-material-sheet p-6 shadow-dialog"
          >
            <p className="text-title-3 text-foreground">
              {phase === "done" ? (isUpdate ? "Game updated" : "Game imported") : isUpdate ? "Updating game…" : "Importing game…"}
            </p>
            <ul className="mt-4 space-y-3">
              {steps.map((step) => (
                <li key={step.label} className="flex items-center gap-3">
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <StepIcon state={step.state} />
                  </span>
                  <span
                    className={cn(
                      "text-sm",
                      step.state === "pending" ? "text-muted-foreground" : "text-foreground",
                      step.state === "active" && "font-medium",
                    )}
                  >
                    {step.label}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
