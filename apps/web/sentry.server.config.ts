// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { setDbErrorReporter } from "@scoutable/shared/lib/report";

Sentry.init({
  dsn: "https://48c5425eb9b89aca6a763561aecd5d6c@o4511984392994816.ingest.de.sentry.io/4511984399351888",

  environment: process.env.VERCEL_ENV ?? "development",

  // No auto-collected user identity or request bodies — user context can be
  // attached explicitly where it's needed.
  dataCollection: {
    userInfo: false,
    httpBodies: [],
  },
});

// Server-side use of the shared DB helpers reports through the same hook as
// the client (see instrumentation-client.ts).
setDbErrorReporter((fn, e) => {
  Sentry.captureMessage(`db:${fn}: ${e.message}`, {
    level: "error",
    tags: { db_fn: fn },
  });
});
