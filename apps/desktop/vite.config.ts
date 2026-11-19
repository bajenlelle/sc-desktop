import { defineConfig, loadEnv, searchForWorkspaceRoot, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import { existsSync, readFileSync } from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
);

// The headless UI harness (docs/headless-ui.md): `vite --mode headless` serves
// the front end to Playwright with Tauri's IPC mocked. Only staging: the
// harness signs in and clicks through real data.
const STAGING_SUPABASE_REF = "edalihizooqdxeekaklf";
const HEADLESS_FIXTURES = path.resolve(__dirname, "headless/fixtures");

/**
 * Puts the Tauri mocks ahead of main.tsx, so they exist before any app module
 * evaluates, and answers a missing local video 404 the way the stream
 * protocol does (Vite would send index.html, which reads as a playable file).
 */
function headlessHarness(): Plugin {
  return {
    name: "scoutable-headless",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url?.startsWith("/@fs/") && !existsSync(decodeURIComponent(url.slice("/@fs".length)))) {
          res.statusCode = 404;
          res.end();
          return;
        }
        next();
      });
    },
    transformIndexHtml(html) {
      // Vite adds ?t=<timestamp> to the src after it drops its caches.
      const main = /<script type="module" src="\/src\/main\.tsx[^"]*"><\/script>/;
      if (!main.test(html)) throw new Error("headless: index.html no longer loads /src/main.tsx");
      return html.replace(main, '<script type="module" src="/headless/install-mocks.ts"></script>\n    $&');
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const headless = mode === "headless";
  const env = headless ? loadEnv(mode, __dirname, "") : {};
  if (headless && !env.VITE_SUPABASE_URL?.includes(STAGING_SUPABASE_REF)) {
    throw new Error(`headless: VITE_SUPABASE_URL must be staging (${STAGING_SUPABASE_REF}); see docs/headless-ui.md`);
  }
  const headlessPort = Number(env.HEADLESS_PORT || 1430);

  return {
    plugins: [
      react(),
      // Uploads sourcemaps to Sentry on CI builds (needs SENTRY_AUTH_TOKEN),
      // then deletes the .map files so they don't ship inside the app bundle.
      sentryVitePlugin({
        org: "scoutable",
        project: "scoutable-desktop",
        // @ts-expect-error process is a nodejs global
        authToken: process.env.SENTRY_AUTH_TOKEN,
        // @ts-expect-error process is a nodejs global
        disable: !process.env.SENTRY_AUTH_TOKEN,
        release: { name: `scoutable@${pkg.version}` },
        sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
        telemetry: false,
      }),
      ...(headless ? [headlessHarness()] : []),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      ...(headless && {
        __HEADLESS__: JSON.stringify({
          port: headlessPort,
          deviceId: env.HEADLESS_DEVICE_ID ?? "",
          fixturesDir: HEADLESS_FIXTURES,
        }),
      }),
    },
    build: {
      sourcemap: true,
    },
    clearScreen: false,
    server: {
      port: headless ? headlessPort : 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? { protocol: "ws", host, port: 1421 }
        : undefined,
      // headless/out: a headless run's state file, screenshots and traces. Watched, each write
      // reloaded the page of a `tauri dev` running from the same checkout.
      watch: { ignored: ["**/src-tauri/**", "**/headless/out/**"] },
      ...(headless && { fs: { allow: [searchForWorkspaceRoot(__dirname), HEADLESS_FIXTURES] } }),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@scoutable/shared": path.resolve(__dirname, "../../packages/shared"),
        ...(headless && {
          "@tauri-apps/plugin-http": path.resolve(__dirname, "headless/plugin-http-shim.ts"),
        }),
      },
    },
  };
});
