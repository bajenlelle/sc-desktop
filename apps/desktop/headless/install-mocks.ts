/**
 * Headless UI harness (docs/headless-ui.md): every Tauri command the front
 * end sends, answered in the browser. `vite --mode headless` puts this script
 * ahead of src/main.tsx (vite.config.ts), so the mocks exist before any app
 * module evaluates; no other mode ever loads it.
 *
 * A command nobody answers here is logged once (`headless: unmocked <cmd>`)
 * and rejected, so a new native call shows up in a spec's output instead of
 * hanging. The native work (export, frames, posters) rejects with
 * `headless: native`, so a spec that reaches it fails loudly.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

/** From vite.config.ts, in headless mode only. */
declare const __HEADLESS__: { port: number; deviceId: string; fixturesDir: string };
declare const __APP_VERSION__: string;

declare global {
  interface Window {
    /** URLs the app asked the system browser to open, in order, for assertions. */
    __headlessOpened: string[];
    /** read_file / delete_file's disk: a spec may put bytes here before a step reads them. */
    __headlessFiles: Map<string, Uint8Array>;
    /** Set up by mockWindows/mockIPC; `convertFileSrc` is the one piece written here. */
    __TAURI_INTERNALS__: { convertFileSrc: (filePath: string, protocol?: string) => string };
  }
}

type Args = Record<string, unknown> | undefined;

const FIXTURE_VIDEO = `${__HEADLESS__.fixturesDir}/game.mp4`;
/** What make-fixture.sh writes: 2 minutes of 1280×720 at 25 fps. */
const FIXTURE_PROBE = { durationMs: 120_000, width: 1280, height: 720, fps: 25 };

/**
 * A stored path to any worktree's fixtures resolves to this server's own, so
 * worktrees that link a staging game to "their" fixture never break each other.
 */
function localPath(path: string): string {
  const fixture = path.match(/\/headless\/fixtures\/([^/]+)$/);
  return fixture ? `${__HEADLESS__.fixturesDir}/${fixture[1]}` : path;
}

/** The stream protocol's stand-in: Vite serves the file, Range requests included. */
function fileUrl(path: string): string {
  const encoded = localPath(path).split("/").map(encodeURIComponent).join("/");
  return `${window.location.origin}/@fs${encoded}`;
}

const native = (cmd: string) => () => Promise.reject(`headless: native ${cmd}`);
const none = () => null;

window.__headlessOpened = [];
window.__headlessFiles = new Map();
let nextListenerId = 1;

const commands: Record<string, (args: Args) => unknown> = {
  // One device per worktree in staging's registry, not one per run. Without
  // HEADLESS_DEVICE_ID the identity is unavailable, as when the Rust side fails.
  get_device_identity: () =>
    __HEADLESS__.deviceId
      ? { hardwareId: __HEADLESS__.deviceId, hostName: `headless-${__HEADLESS__.port}` }
      : Promise.reject("headless: no HEADLESS_DEVICE_ID"),
  get_temp_dir: () => "/tmp",
  probe_video: (args) =>
    localPath(String(args?.path)) === FIXTURE_VIDEO ? FIXTURE_PROBE : Promise.reject("probe_video: could not read the video"),
  read_file: (args) => {
    const bytes = window.__headlessFiles.get(String(args?.path));
    return bytes ? bytes.slice().buffer : Promise.reject(`read_file: no such file ${String(args?.path)}`);
  },
  delete_file: (args) => {
    window.__headlessFiles.delete(String(args?.path));
    return null;
  },
  menu_set_enabled: none,
  menu_set_text: none,
  menu_game_tabs: none,
  menu_set_go_keys: none,
  menu_sync_theme: none,
  grab_frames: native("grab_frames"),
  extract_poster_frame: native("extract_poster_frame"),
  extract_clip_poster: native("extract_clip_poster"),
  export_playlist: native("export_playlist"),
  export_clip_for_ship: native("export_clip_for_ship"),
  // No export ever starts here, so there is never one to cancel.
  cancel_export: none,

  "plugin:app|version": () => __APP_VERSION__,
  "plugin:updater|check": none,
  "plugin:deep-link|get_current": none,
  "plugin:dialog|open": (args) => {
    const options = (args?.options ?? {}) as { directory?: boolean; multiple?: boolean };
    const picked = options.directory ? __HEADLESS__.fixturesDir : FIXTURE_VIDEO;
    return options.multiple ? [picked] : picked;
  },
  "plugin:opener|open_url": (args) => {
    window.__headlessOpened.push(String(args?.url));
    return null;
  },
  "plugin:process|restart": none,
  "plugin:process|exit": none,
  "plugin:event|listen": () => nextListenerId++,
  "plugin:event|unlisten": none,
  "plugin:event|emit": none,
  "plugin:event|emit_to": none,
};

/** Window queries answer as a focused, windowed app; window and webview setters do nothing. */
function windowDefault(cmd: string): unknown {
  if (cmd === "plugin:window|is_focused" || cmd === "plugin:window|is_visible") return true;
  if (cmd.startsWith("plugin:window|is_")) return false;
  if (cmd === "plugin:window|scale_factor") return window.devicePixelRatio;
  if (cmd === "plugin:window|inner_size" || cmd === "plugin:window|outer_size") {
    return { width: window.innerWidth, height: window.innerHeight };
  }
  if (cmd === "plugin:window|inner_position" || cmd === "plugin:window|outer_position") return { x: 0, y: 0 };
  return null;
}

const warned = new Set<string>();

mockWindows("main");
mockIPC(async (cmd, payload) => {
  const answer = commands[cmd];
  if (answer) return answer(payload as Args);
  if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return windowDefault(cmd);
  // Sentry's IPC transport: a headless run reports nothing.
  if (cmd.startsWith("plugin:sentry|")) return null;
  if (!warned.has(cmd)) {
    warned.add(cmd);
    console.warn("headless: unmocked", cmd);
  }
  throw `headless: unmocked ${cmd}`;
});
window.__TAURI_INTERNALS__.convertFileSrc = (filePath: string) => fileUrl(filePath);
