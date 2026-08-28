"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { ReportProblemDialog } from "@/components/report-problem-dialog";

/**
 * Floating feedback entry point, shown on every authenticated page during
 * beta. Bottom-left because the sonner toaster owns bottom-right.
 */
export function FeedbackFab() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-label="Send feedback"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageSquarePlus className="h-4 w-4" />
        <span className="hidden sm:inline">Feedback</span>
      </button>
      <ReportProblemDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
