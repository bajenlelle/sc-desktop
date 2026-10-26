import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@scoutable/shared/lib/safe-next";
import { DEFAULT_NEXT } from "@/lib/with-next";
import { pendingInvitePath } from "@/lib/pending-invite";

/**
 * Where the confirmation email lands (supabase/templates/confirm.html):
 * the token in the link is verified here, on the server, so the session
 * is made in whichever browser opens the email — the PKCE flow behind
 * /auth/callback needs the browser that signed up. Password resets stay
 * on /reset-password, which spends its token only when the new password
 * is submitted, out of reach of mail scanners.
 */
const TYPES: ReadonlySet<string> = new Set(["signup", "email", "magiclink", "invite", "email_change"]);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") ?? "";
  const next = safeNext(searchParams.get("next"));

  const login = new URL("/login", origin);
  if (next) login.searchParams.set("next", next);

  if (!tokenHash || !TYPES.has(type)) {
    login.searchParams.set("error", "auth_callback_error");
    return NextResponse.redirect(login);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
  if (error) {
    // Spent (a mail scanner opened it first) or expired. The email is
    // confirmed either way once a scanner has been through, so sign-in works.
    login.searchParams.set("notice", "link_used");
    return NextResponse.redirect(login);
  }
  return NextResponse.redirect(`${origin}${next ?? pendingInvitePath(data.user) ?? DEFAULT_NEXT}`);
}
