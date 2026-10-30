/**
 * Read-only mode for driving a dev build against production from a
 * simulator or emulator: every write is refused before it leaves the
 * device, so a test session can browse, play and switch themes without
 * touching anyone's data. On only when `__DEV__` and
 * EXPO_PUBLIC_READ_ONLY=1; store builds never run it.
 *
 * It wraps the global fetch as a side effect of being imported, so it must
 * be imported before the Supabase client is created (supabase-js captures
 * fetch at creation): lib/supabase.ts and the root layout import it first.
 *
 * Allowed: reads, the read-only RPCs below, and sign-in / session / sign-out.
 * Refused (403, logged): table writes, every other RPC (touch_device,
 * set_my_team, join_by_code, reminders, push tokens…), edge functions,
 * storage uploads, password resets, sign-ups, account updates, the web
 * app's API (account deletion), and analytics / error reporting. Profile
 * reads lose their theme columns, so the device keeps its own theme instead
 * of adopting the account's.
 */

import { LogBox } from "react-native";

const READ_RPCS = new Set([
  "check_onboarding_needed",
  "count_club_matches_this_month",
  "find_video_sync_hints",
  "get_highlight_share",
  "get_invite_preview",
  "get_my_orgs",
  "get_org_members",
  "get_space_team_suggestions",
  "list_device_outliers",
]);

/** Auth endpoints a test session needs: sign in, refresh, read the user, sign out. */
const AUTH_ALLOWED = [/\/auth\/v1\/token/, /\/auth\/v1\/logout/, /\/auth\/v1\/authorize/, /\/auth\/v1\/callback/];

const NO_DATA_HOSTS = [/posthog\.com/, /sentry\.io/];

function requestParts(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : undefined) ?? "GET").toUpperCase();
  return { url, method };
}

function refusal(method: string, url: string): string | null {
  if (NO_DATA_HOSTS.some((h) => h.test(url))) return "analytics/errors";
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const read = method === "GET" || method === "HEAD" || method === "OPTIONS";

  if (path.startsWith("/rest/v1/rpc/")) {
    const name = path.slice("/rest/v1/rpc/".length);
    return READ_RPCS.has(name) ? null : `rpc ${name}`;
  }
  if (path.startsWith("/rest/v1/")) return read ? null : "table write";
  if (path.startsWith("/functions/v1/")) return read ? null : "edge function";
  if (path.startsWith("/storage/v1/")) return read ? null : "storage write";
  if (path.startsWith("/auth/v1/")) {
    if (read || AUTH_ALLOWED.some((p) => p.test(path))) return null;
    return path === "/auth/v1/user" ? "account update" : "auth write";
  }
  if (/scoutable\.se/.test(url) && !read) return "web API";
  return null;
}

async function withoutThemeColumns(res: Response): Promise<Response> {
  const text = await res.text();
  let body = text;
  try {
    const json = JSON.parse(text);
    const strip = (row: unknown) => {
      if (row && typeof row === "object") {
        for (const k of ["theme_dark", "theme_light", "theme_mode"]) {
          if (k in row) (row as Record<string, unknown>)[k] = null;
        }
      }
    };
    if (Array.isArray(json)) json.forEach(strip);
    else strip(json);
    body = JSON.stringify(json);
  } catch {
    // Not JSON: pass it through untouched.
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

if (__DEV__ && process.env.EXPO_PUBLIC_READ_ONLY === "1") {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method } = requestParts(input, init);
    const reason = refusal(method, url);
    if (reason) {
      console.warn(`[read-only] blocked ${reason}: ${method} ${url.split("?")[0]}`);
      return new Response(JSON.stringify({ message: "Blocked by read-only mode", code: "read_only" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
    const res = await original(input, init);
    return method === "GET" && /\/rest\/v1\/profiles/.test(url) ? withoutThemeColumns(res) : res;
  };
  // The refusals are expected; keep them out of the on-screen error overlay
  // (Metro's console still shows them) so real errors stand out.
  LogBox.ignoreLogs(["Blocked by read-only mode", "[read-only]"]);
  console.warn("[read-only] on: writes to production are blocked in this session");
}

export {};
