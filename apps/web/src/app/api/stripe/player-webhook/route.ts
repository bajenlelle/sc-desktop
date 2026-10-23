import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { adminClient, fulfillCheckout, isPlayerKind, stripe } from "@/lib/player-purchase";
import { captureServerEvent } from "@/lib/posthog-server";

/**
 * Stripe webhook for player purchases (one-time Checkout, mode "payment").
 * A separate endpoint from scoutable.se's subscription webhook, which ignores
 * payment sessions. Events: checkout.session.completed,
 * checkout.session.async_payment_succeeded/_failed, charge.refunded.
 *
 * Answers 200 only once the database write has succeeded, so Stripe retries
 * a failed fulfilment instead of dropping it.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_PLAYER_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "payment" || !isPlayerKind(session.metadata?.kind)) break;
        await fulfillCheckout(session.id);
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (!isPlayerKind(session.metadata?.kind)) break;
        console.warn("[player-webhook] async payment failed", { session: session.id });
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        // Partial refunds are goodwill; only a full refund takes the purchase back.
        if (!charge.refunded) break;
        const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (!pi) break;
        const { data, error } = await adminClient().rpc("refund_player_purchase", { p_payment_intent_id: pi });
        if (error) throw new Error(`refund_player_purchase failed: ${error.message}`);
        const res = (data ?? {}) as { refunded?: boolean; user_id?: string; kind?: string };
        if (res.refunded && res.user_id) {
          await captureServerEvent(res.user_id, "player_purchase_refunded", {
            kind: res.kind,
            amount: charge.amount_refunded,
            currency: charge.currency,
          });
        }
        break;
      }
    }
  } catch (err) {
    console.error(`[player-webhook] ${event.type} failed:`, err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Fulfilment failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
