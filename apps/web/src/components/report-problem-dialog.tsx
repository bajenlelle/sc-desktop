"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { submitFeedbackReport } from "@scoutable/shared/lib/feedback";
import { createClient } from "@/lib/supabase/client";

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const APP_VERSION = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev";

interface ReportProblemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReportProblemDialog({ open, onOpenChange }: ReportProblemDialogProps) {
  const pathname = usePathname();
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<{ name: string; base64: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleFile(file: File | undefined) {
    if (!file) return setScreenshot(null);
    if (file.size > MAX_SCREENSHOT_BYTES) {
      toast.error("Screenshot must be under 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setScreenshot({ name: file.name, base64: dataUrl.split(",")[1] ?? "" });
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    const result = await submitFeedbackReport(createClient(), {
      description: description.trim(),
      app: "web",
      appVersion: APP_VERSION,
      os: navigator.userAgent,
      route: pathname,
      sentryEventId: Sentry.lastEventId(),
      screenshotBase64: screenshot?.base64,
    });
    setSubmitting(false);
    if (result.ok) {
      toast.success("Thanks — feedback received!");
      setDescription("");
      setScreenshot(null);
      onOpenChange(false);
    } else {
      toast.error(
        result.error === "too_many_reports"
          ? "You've sent a few reports recently — please wait a bit before sending another."
          : "Couldn't send the report. Please try again.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            Found a bug, got an idea, or something confusing? Tell us — your current page is
            attached automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="report-description">What happened?</Label>
            <textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="e.g. The playlist won't play past the second clip…"
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-screenshot">Screenshot (optional)</Label>
            <input
              id="report-screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleFile(e.target.files?.[0])}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!description.trim() || submitting}>
            {submitting ? "Sending…" : "Send Feedback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
