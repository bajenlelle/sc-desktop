import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// RFC 8058 one-click unsubscribe: mailbox providers POST here from the
// List-Unsubscribe header that marketing emails carry (send-email). The token
// is the whole credential, and unsubscribe_marketing can only withdraw
// consent, so the anon key is enough. The page at /unsubscribe is the
// human-facing version of the same link.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!UUID.test(token)) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { error } = await supabase.rpc("unsubscribe_marketing", { p_token: token });
  if (error) {
    return NextResponse.json({ error: "Could not unsubscribe" }, { status: 500 });
  }
  // An unknown token answers the same: nothing to reveal, nothing left to do.
  return NextResponse.json({ ok: true });
}
