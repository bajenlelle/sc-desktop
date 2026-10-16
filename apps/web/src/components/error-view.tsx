"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/status-screen";

/**
 * What an error boundary shows: the error is reported to Sentry, and the
 * person gets one way forward. Shared by the root boundary (the whole window)
 * and the signed-in app's (inside the shell, so navigation stays).
 */
export function ErrorView({
  error,
  reset,
  className,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  className?: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <StatusScreen
      className={className}
      icon={<AlertTriangle />}
      title="Something went wrong"
      body="The error has been reported automatically. You can try again, or reload the page if the problem sticks around."
      actions={<Button onClick={reset}>Try again</Button>}
    />
  );
}
