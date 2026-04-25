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
  let email: string | undefined;

  // Support both cookie-based auth (web) and Bearer token auth (desktop)
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");

  if (token) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } },
    );
    const { data: { user } } = await supabase.auth.getUser(token);
    email = user?.email ?? undefined;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    email = user?.email ?? undefined;
  }

  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  // Look up Stripe customer ID
  const supabaseAdmin = await createClient();
  const { data } = await supabaseAdmin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("email", email)
    .maybeSingle();

  if (!data?.stripe_customer_id) {
    return NextResponse.json({ error: "No active subscription" }, { status: 400, headers: corsHeaders });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: data.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin}/profile`,
  });

  return NextResponse.json({ url: session.url }, { headers: corsHeaders });
}
