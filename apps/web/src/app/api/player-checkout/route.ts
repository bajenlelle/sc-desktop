import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { activePass, parsePlayerAccess, seasonLabel } from "@scoutable/shared/lib/player-access";
import { isPlayerKind, priceIdFor, stripe } from "@/lib/player-purchase";

/**
 * One-time Checkout for a player purchase: a single game or a season pass.
 *
 * Desktop calls it with the user's Bearer token (same dual auth as
 * billing-portal) and opens the returned URL in the browser; the same URL can
 * be paid on a parent's phone (Swish), because the session is tied to the
 * player by client_reference_id. A season pass is for the personal space's
 * "Your team" in the season on sale, read here, never from the client.
 * Fulfilment: /api/stripe/player-webhook and /purchase/complete.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

const json = (status: number, body: unknown) => NextResponse.json(body, { status, headers: corsHeaders });

// Shown on the Checkout page next to the consent box. Access starts at
// once, so the buyer asks for that and waives the right of withdrawal
// (distansavtalslagen 2 kap. 11 §). Wording awaits a lawyer's review.
const WAIVER = {
  sv: "Jag vill få tillgång direkt och förstår att min ångerrätt upphör när tillgången har börjat.",
  en: "I want access right away, and I understand that my right of withdrawal ends once access has started.",
};

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const supabase = token
    ? createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createClient();
  const {
    data: { user },
  } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  if (!user?.email) return json(401, { error: "unauthorized" });

  let body: { kind?: unknown; game_key?: unknown; surface?: unknown; lang?: unknown };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "invalid_body" });
  }
  if (!isPlayerKind(body.kind)) return json(400, { error: "invalid_kind" });
  const kind = body.kind;
  const gameKey = typeof body.game_key === "string" ? body.game_key.slice(0, 100) : "";
  const surface = typeof body.surface === "string" ? body.surface.slice(0, 40) : "";
  const lang = body.lang === "sv" || body.lang === "en" ? body.lang : null;

  const { data: raw, error: accessError } = await supabase.rpc("get_my_player_access");
  if (accessError) {
    console.error("[player-checkout] get_my_player_access failed:", accessError.message);
    return json(500, { error: "access_lookup_failed" });
  }
  const access = parsePlayerAccess(raw);
  if (!access.enabled) return json(403, { error: "sales_closed" });

  const team = access.team;
  const seasonId = access.seasonOnSale;
  if (kind === "season_pass") {
    if (!team) return json(400, { error: "no_team" });
    if (!seasonId || !team.inSeasonOnSale) return json(400, { error: "team_not_in_season" });
    if (activePass(access)?.teamId === team.id) return json(400, { error: "already_have_pass" });
  }

  // Reuse the Stripe customer of an earlier subscription, if any (RLS: own row).
  const { data: customerRow } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("email", user.email)
    .maybeSingle();

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).replace(/\/$/, "");
  const season = seasonId ? seasonLabel(seasonId) : "";
  const summary =
    kind === "season_pass" && team
      ? `Season pass ${season} · ${team.name} (${team.leagueName})`
      : "Single game";

  const metadata: Record<string, string> = {
    kind,
    user_id: user.id,
    surface,
    ...(gameKey ? { game_key: gameKey } : {}),
    ...(kind === "season_pass" && team && seasonId
      ? { season_id: seasonId, league_team_id: team.id, team_name: team.name.slice(0, 200) }
      : {}),
  };

  let priceId: string;
  try {
    priceId = await priceIdFor(kind);
  } catch (err) {
    console.error("[player-checkout] price lookup failed:", err instanceof Error ? err.message : err);
    return json(503, { error: "price_not_configured" });
  }

  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    metadata,
    payment_intent_data: { metadata, description: `Scoutable · ${summary}` },
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: { message: lang === "en" ? WAIVER.en : WAIVER.sv },
      submit: {
        message:
          kind === "season_pass" && team
            ? `${summary}. Every ${team.name} game this season, playoffs included.`
            : access.hasPaid
              ? "One game, yours to keep."
              : "One game, yours to keep. Also opens export for all your games.",
      },
    },
    allow_promotion_codes: true,
    locale: lang ?? "auto",
    success_url: `${appUrl}/purchase/complete?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/purchase/complete?canceled=1`,
    ...(customerRow?.stripe_customer_id
      ? { customer: customerRow.stripe_customer_id }
      : { customer_email: user.email, customer_creation: "always" as const }),
  };

  try {
    const session = await stripe().checkout.sessions.create(params);
    return json(200, { url: session.url, id: session.id });
  } catch (err) {
    const e = err as { message?: string; type?: string; code?: string };
    console.error("[player-checkout] Stripe error:", { message: e.message, type: e.type, code: e.code, kind });
    return json(502, { error: "checkout_failed" });
  }
}
