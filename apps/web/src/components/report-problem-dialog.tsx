"use client";

import { useRef, useState } from "react";
import { usePathname } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const fileRef = useRef<HTMLInputElement>(null);

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
      toast.success("Thanks. We got your feedback.");
      setDescription("");
      setScreenshot(null);
      onOpenChange(false);
    } else {
      toast.error(
        result.error === "too_many_reports"
          ? "You've sent a few reports recently. Wait a little before sending another."
          : "Couldn't send the report. Try again.",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            A bug, an idea, something confusing: tell us. The page you&apos;re on is attached automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="report-description">What happened?</Label>
            <Textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              maxLength={4000}
              placeholder="The playlist won't play past the second clip…"
            />
          </div>
          <div className="flex items-center gap-3">
            {/* The real file input stays hidden behind a regular button. */}
            <input
              ref={fileRef}
              id="report-screenshot"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <ImagePlus />
              {screenshot ? "Change screenshot…" : "Attach screenshot…"}
            </Button>
            {screenshot ? (
              <span className="flex min-w-0 items-center gap-1 rounded-full bg-fill-2 py-0.5 pr-1 pl-2.5 text-callout">
                <span className="truncate">{screenshot.name}</span>
                <button
                  type="button"
                  aria-label="Remove screenshot"
                  onClick={() => {
                    setScreenshot(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="flex size-4 items-center justify-center rounded-full opacity-70 hover:bg-fill-3 hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </span>
            ) : (
              <span className="text-callout text-muted-foreground">Optional, up to 2 MB</span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!description.trim() || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Send feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
