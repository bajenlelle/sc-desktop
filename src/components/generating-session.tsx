import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const STEPS = [
  "Game data loaded",
  "Building event timeline…",
  "Syncing video",
  "Session ready",
];

interface GeneratingSessionProps {
  isVisible: boolean;
  onComplete: () => void;
}

export function GeneratingSession({ isVisible, onComplete }: GeneratingSessionProps) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [done, setDone] = useState(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    if (!isVisible) {
      setCurrentStep(-1);
      setDone(false);
      return;
    }

    setCurrentStep(0);

    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= STEPS.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setDone(true);
            onCompleteRef.current();
          }, 500);
          return next;
        }
        return next;
      });
    }, 700);

    return () => clearInterval(interval);
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-2xl">
        <p className="mb-1 text-center text-xs font-semibold uppercase tracking-widest text-primary">
          Scoutable
        </p>
        <h2 className="mb-6 text-center text-xl font-bold text-foreground">
          {done ? "Your session is ready" : "Creating your Scoutable Session"}
        </h2>
        <div className="space-y-3">
          {STEPS.map((step, i) => {
            const isCompleted = i < currentStep || (i === STEPS.length - 1 && done);
            const isActive = i === currentStep && !done;
            return (
              <motion.div
                key={step}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08, duration: 0.2 }}
                className="flex items-center gap-3"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {isCompleted ? (
                    <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 16 16" fill="none">
                      <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : isActive ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-muted" />
                  )}
                </span>
                <span
                  className={
                    isCompleted
                      ? "text-sm text-emerald-400"
                      : isActive
                      ? "text-sm font-medium text-foreground"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {step}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
