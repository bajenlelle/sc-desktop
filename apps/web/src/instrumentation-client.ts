// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { setDbErrorReporter } from "@scoutable/shared/lib/report";

Sentry.init({
  dsn: "https://48c5425eb9b89aca6a763561aecd5d6c@o4511984392994816.ingest.de.sentry.io/4511984399351888",

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",

  // No auto-collected user identity or request bodies — user context can be
  // attached explicitly where it's needed.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },

  // Network noise that isn't actionable and eats the free-tier quota.
  ignoreErrors: [
    /Failed to fetch/i,
    /NetworkError/i,
    /Load failed/i,
    "AbortError",
    /ResizeObserver loop/,
  ],
});

// Surface the shared DB helpers' gracefully-swallowed failures. captureMessage
// with a db_fn tag so Sentry groups per function, not one mega-issue.
setDbErrorReporter((fn, e) => {
  Sentry.captureMessage(`db:${fn}: ${e.message}`, {
    level: "error",
    tags: { db_fn: fn },
  });
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
