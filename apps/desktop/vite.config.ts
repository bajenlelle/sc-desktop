import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";
import { readFileSync } from "fs";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
);

export default defineConfig(async () => ({
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
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: true,
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@scoutable/shared": path.resolve(__dirname, "../../packages/shared"),
    },
  },
}));
