import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@scoutable/shared"],
  // The dev-mode badge sits bottom left, on top of the sidebar's account row
  // and the tab bar's first tab. Build errors still show as an overlay.
  devIndicators: false,
  // The routes the web had before it mirrored the desktop's structure
  // (milestone 3 of the cloud game videos): Games became the Library and
  // Get started folded into Home. Temporary, so a client keeps asking: the
  // query string (`?match=`, the ready email's `?t=`) carries over on its own.
  async redirects() {
    return [
      { source: "/games", destination: "/library", permanent: false },
      { source: "/games/import", destination: "/library/import", permanent: false },
      { source: "/games/:matchId", destination: "/library/:matchId", permanent: false },
      { source: "/get-started", destination: "/home", permanent: false },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "scoutable",

  project: "scoutable-web",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
