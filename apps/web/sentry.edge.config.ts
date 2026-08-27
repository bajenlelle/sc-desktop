// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

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
