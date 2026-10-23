/**
 * Where Stripe Checkout returns after a player purchase (and after a
 * cancel). Public, like /unsubscribe: the Checkout Session id is the
 * credential, and fulfilment is idempotent, so running it here as well as in
 * the webhook only makes the purchase show up sooner. The desktop app polls
 * for the purchase meanwhile, so this page only has to say what happened.
 */
import type { Metadata } from "next";
import { fulfillCheckout, type FulfilResult } from "@/lib/player-purchase";
import PurchaseCompleteView, { type CompleteState } from "./purchase-complete-view";

export const metadata: Metadata = {
  title: "Purchase — Scoutable",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ session_id?: string; canceled?: string }> };

export default async function PurchaseCompletePage({ searchParams }: Props) {
  const { session_id, canceled } = await searchParams;
  if (canceled) return <PurchaseCompleteView state={{ kind: "canceled" }} />;

  let state: CompleteState = { kind: "unknown" };
  if (session_id && /^cs_[A-Za-z0-9_]+$/.test(session_id)) {
    try {
      const result: FulfilResult = await fulfillCheckout(session_id);
      if (result.status === "fulfilled" || result.status === "already") {
        state = { kind: "ready", purchase: result.kind, teamName: result.teamName, seasonId: result.seasonId };
      } else if (result.status === "unpaid") {
        state = { kind: "processing" };
      }
    } catch (err) {
      console.error("[purchase/complete] fulfil failed:", err instanceof Error ? err.message : err);
    }
  }
  return <PurchaseCompleteView state={state} />;
}
