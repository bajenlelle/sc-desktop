/**
 * Player passes on the server: one-time Stripe Checkout for a single game or
 * a season pass, and its fulfilment. Server-only (Stripe secret, service
 * role). The webhook and the /purchase/complete page both call
 * fulfillCheckout, as Stripe recommends; fulfill_player_purchase is
 * idempotent on the Checkout Session id, so whichever runs second is a no-op.
 */
import Stripe from "stripe";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { captureServerEvent } from "@/lib/posthog-server";

export const PLAYER_KINDS = ["single_game", "season_pass"] as const;
export type PlayerKind = (typeof PLAYER_KINDS)[number];

export function isPlayerKind(v: unknown): v is PlayerKind {
  return typeof v === "string" && (PLAYER_KINDS as readonly string[]).includes(v);
}

/** Stripe price lookup keys (set on the prices in the Dashboard). */
export const PRICE_LOOKUP_KEYS: Record<PlayerKind, string> = {
  single_game: "player_single_game",
  season_pass: "player_season_pass",
};

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key);
  return _stripe;
}

let _admin: SupabaseClient | null = null;
export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return _admin;
}

const priceCache = new Map<string, string>();
/** The active price id behind a lookup key (cached per server instance). */
export async function priceIdFor(kind: PlayerKind): Promise<string> {
  const lookupKey = PRICE_LOOKUP_KEYS[kind];
  const cached = priceCache.get(lookupKey);
  if (cached) return cached;
  const { data } = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const id = data[0]?.id;
  if (!id) throw new Error(`No active Stripe price with lookup key ${lookupKey}`);
  priceCache.set(lookupKey, id);
  return id;
}

export type FulfilResult =
  | { status: "fulfilled" | "already"; kind: PlayerKind; teamName: string | null; seasonId: string | null }
  | { status: "unpaid"; kind: PlayerKind }
  | { status: "not_player" };

/**
 * Records a paid player Checkout Session. Safe to call any number of times,
 * concurrently, for the same session. Throws on database errors so the
 * webhook answers 500 and Stripe retries.
 */
export async function fulfillCheckout(sessionId: string): Promise<FulfilResult> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ["line_items", "payment_intent.latest_charge"],
  });
  const md = session.metadata ?? {};
  if (session.mode !== "payment" || !isPlayerKind(md.kind)) return { status: "not_player" };
  const kind = md.kind;
  if (session.payment_status !== "paid") return { status: "unpaid", kind };

  const userId = session.client_reference_id ?? md.user_id;
  if (!userId) throw new Error(`Player checkout ${session.id} has no user`);

  const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const piId = pi?.id ?? (typeof session.payment_intent === "string" ? session.payment_intent : null);
  const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const quantity = session.line_items?.data[0]?.quantity ?? 1;

  const { data, error } = await adminClient().rpc("fulfill_player_purchase", {
    p_checkout_session_id: session.id,
    p_user_id: userId,
    p_kind: kind,
    p_quantity: quantity,
    p_amount_total: session.amount_total ?? 0,
    p_currency: session.currency ?? "sek",
    p_payment_intent_id: piId,
    p_receipt_url: charge?.receipt_url ?? null,
    p_season_id: kind === "season_pass" ? md.season_id ?? null : null,
    p_league_team_id: kind === "season_pass" ? md.league_team_id ?? null : null,
    p_game_key: md.game_key || null,
  });
  if (error) throw new Error(`fulfill_player_purchase failed: ${error.message}`);

  const res = (data ?? {}) as { already_fulfilled?: boolean; duplicate_pass?: boolean };
  if (res.duplicate_pass) {
    // Paid twice for the same team and season: the second payment needs a refund.
    console.error("[player-purchase] duplicate season pass paid", { session: session.id, user: userId });
  }
  if (!res.already_fulfilled) {
    await captureServerEvent(userId, "player_purchase_completed", {
      kind,
      quantity,
      amount: session.amount_total,
      currency: session.currency,
      surface: md.surface,
      payment_method: charge?.payment_method_details?.type,
      duplicate_pass: res.duplicate_pass ?? false,
    });
  }
  return {
    status: res.already_fulfilled ? "already" : "fulfilled",
    kind,
    teamName: md.team_name || null,
    seasonId: md.season_id || null,
  };
}
