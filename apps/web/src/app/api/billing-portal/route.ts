import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  let supabase;
  let email: string | undefined;

  // Support both cookie-based auth (web) and Bearer token auth (desktop)
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (token) {
    supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const { data: { user } } = await supabase.auth.getUser(token);
    email = user?.email ?? undefined;
  } else {
    supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    email = user?.email ?? undefined;
  }

  if (!email) {
    console.error("[billing-portal] No email from auth. Token present:", !!token);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  console.log("[billing-portal] Authenticated user email:", email);

  // Reuse the same authenticated client so RLS passes
  const { data, error: dbError } = await supabase
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("email", email)
    .maybeSingle();

  console.log("[billing-portal] DB query result:", { data, dbError: dbError?.message ?? null });

  if (!data?.stripe_customer_id) {
    return NextResponse.json({ error: "No active subscription" }, { status: 400, headers: corsHeaders });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin}/profile`,
    });
    return NextResponse.json({ url: session.url }, { headers: corsHeaders });
  } catch (err) {
    const stripeErr = err as { message?: string; type?: string; code?: string };
    console.error("[billing-portal] Stripe portal error:", {
      message: stripeErr.message,
      type: stripeErr.type,
      code: stripeErr.code,
      customer: data.stripe_customer_id,
      keyMode: process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "live" : "test",
    });
    return NextResponse.json(
      { error: "Failed to open billing portal" },
      { status: 500, headers: corsHeaders },
    );
  }
}
