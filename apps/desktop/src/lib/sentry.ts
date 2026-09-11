import * as Sentry from "@sentry/react";
import { defaultOptions } from "tauri-plugin-sentry-api";
import { setDbErrorReporter } from "@scoutable/shared/lib/report";

// Webview errors route through the Rust Sentry client (tauri-plugin-sentry's
// IPC transport in `defaultOptions`), so they arrive enriched with OS/device
// context and merged Rust breadcrumbs. The DSN lives only on the Rust side —
// see src-tauri/src/lib.rs; debug builds stay offline unless a DSN is
// exported there.
Sentry.init({
  ...defaultOptions,
  release: `scoutable@${__APP_VERSION__}`,
  environment: import.meta.env.VITE_ENV ?? "development",
  sampleRate: 1,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  ignoreErrors: [
    /Failed to fetch/i,
    /NetworkError/i,
    /Load failed/i,
    "AbortError",
    /ResizeObserver loop/,
    // tauri-plugin-http's fetch shim fires internal fire-and-forget cleanup
    // invokes that reject as bare strings when their Rust resource is already
    // gone (a benign teardown race; the "AbortError" entry above can't match
    // a non-Error reason). Root cause fixed in r2-upload.ts; this is the net.
    /resource id \d+ is invalid/i,
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

export { Sentry };
