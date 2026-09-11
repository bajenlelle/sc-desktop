import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Realtime heartbeats from a Web Worker, not the main thread: Chrome
      // throttles hidden-tab timers to ~1/min, starving the 25s heartbeat and
      // killing the socket ("heartbeat timeout") every time a tab sits in the
      // background — the dominant source of realtime churn (issue #24).
      realtime: { worker: true },
    }
  );
}
