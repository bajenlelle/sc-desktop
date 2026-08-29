// Scoutable — Expo push notification Edge Function
// Called from Postgres triggers and RPCs via pg_net (see
// _send_push_notification in migrations/20260830100000_push_notifications.sql).
// Auth: caller must send the x-push-secret header matching PUSH_NOTIFICATION_SECRET.
//
// The client owns the app-icon badge count (derived from unwatched playlists),
// so messages deliberately carry no `badge` field — a server-set number would
// fight the feed-derived one and go stale.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PUSH_SECRET = Deno.env.get("PUSH_NOTIFICATION_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;

interface SendPushRequest {
  user_id: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "content-type, x-push-secret",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Verify shared secret. Fail closed: a missing secret must never mean
  // "no auth" on a publicly reachable function.
  if (!PUSH_SECRET) {
    console.error(
      "[send-push] PUSH_NOTIFICATION_SECRET is not configured — refusing all requests",
    );
    return new Response("Server misconfigured", { status: 500 });
  }
  if ((req.headers.get("x-push-secret") ?? "") !== PUSH_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: SendPushRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { user_id, title } = body;
  if (!user_id || !title) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: user_id, title" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: tokens, error: tokenError } = await supabase
    .from("push_tokens")
    .select("token")
    .eq("user_id", user_id);

  if (tokenError) {
    console.error(`[send-push] Token lookup failed for ${user_id}:`, tokenError.message);
    return new Response(JSON.stringify({ error: tokenError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = tokens.map(({ token }) => ({
    to: token,
    title,
    body: body.body ?? "",
    data: body.data ?? {},
    sound: "default",
    channelId: "default",
    priority: "high",
  }));

  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`[send-push] Expo API error:`, await res.text());
      continue;
    }
    const { data: tickets } = (await res.json()) as { data?: ExpoPushTicket[] };
    // Tickets come back in message order — zip by index to find dead tokens.
    // Receipts polling (the delayed second pass) is deliberately skipped in
    // v1: dead-token cleanup is already covered by these immediate ticket
    // errors, sign-out deletion, and sign-in upsert reassignment.
    tickets?.forEach((ticket, idx) => {
      if (ticket.status === "error") {
        console.error(`[send-push] Ticket error:`, ticket.message ?? ticket.details?.error);
        if (ticket.details?.error === "DeviceNotRegistered") {
          deadTokens.push(chunk[idx].to);
        }
      }
    });
  }

  if (deadTokens.length > 0) {
    const { error: deleteError } = await supabase
      .from("push_tokens")
      .delete()
      .in("token", deadTokens);
    if (deleteError) {
      console.error("[send-push] Dead-token cleanup failed:", deleteError.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent: messages.length - deadTokens.length }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
