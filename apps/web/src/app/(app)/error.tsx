"use client";

import { ErrorView } from "@/components/error-view";

// The signed-in app's error boundary: it replaces only the page, so the
// sidebar and tab bar stay and the person can go somewhere else.
export default function AppErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorView error={error} reset={reset} className="flex-1 pb-[var(--tab-bar-height)]" />;
}
