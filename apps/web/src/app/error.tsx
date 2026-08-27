"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Route-segment error boundary: keeps the app shell (navbar, theme) alive and
// offers a retry, unlike global-error.tsx which replaces the whole document.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          The error has been reported automatically. You can try again, or reload the page if the
          problem sticks around.
        </p>
        <button
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
