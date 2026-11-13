/**
 * Headless UI harness (docs/headless-ui.md): `@tauri-apps/plugin-http` in
 * `vite --mode headless`, where there is no Rust side to carry the request.
 * The browser's own fetch does it instead, so a cross-origin call the plugin
 * made without CORS (Genius' hosted stats pages, the web app's API, R2) can
 * fail here where the app succeeds. The app type-checks its calls against the
 * real plugin; the plugin's client options (`connectTimeout`,
 * `maxRedirections`, `proxy`, `danger`) reach the browser's fetch, which
 * ignores them.
 */
export const fetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
