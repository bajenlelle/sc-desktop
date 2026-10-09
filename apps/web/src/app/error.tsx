"use client";

import { ErrorView } from "@/components/error-view";

// Root error boundary: everything outside the signed-in app (sign-in, join,
// shared highlights), and the app's own layout. Pages inside the app have
// their own boundary in (app)/error.tsx, which keeps the shell. Unlike
// global-error.tsx, the root layout (theme, fonts) stays.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView error={error} reset={reset} className="min-h-dvh" />;
}
