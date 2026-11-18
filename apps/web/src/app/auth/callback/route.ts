import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@scoutable/shared/lib/safe-next";
import { DEFAULT_NEXT } from "@/lib/with-next";
import { pendingInvitePath } from "@/lib/pending-invite";
import { SIGNUP_LANG_COOKIE, parseSignupLang } from "@/lib/signup-lang";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  const flow = searchParams.get("flow");

  if (code) {
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

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // OAuth signups carry the landing language in a short-lived cookie.
      // The welcome email reads user_metadata.lang ~10 min after confirm,
      // so writing it here is in time. Never blocks the redirect.
      const lang = parseSignupLang(cookieStore.get(SIGNUP_LANG_COOKIE)?.value ?? null);
      if (lang && !data.user?.user_metadata?.lang) {
        try {
          await supabase.auth.updateUser({ data: { lang } });
        } catch {
          // best effort
        }
      }
      const res = NextResponse.redirect(`${origin}${next ?? pendingInvitePath(data.user) ?? DEFAULT_NEXT}`);
      res.cookies.delete(SIGNUP_LANG_COOKIE);
      return res;
    }
  }

  // Supabase adds `code` only once it has verified the link, so a signup
  // link that can't be exchanged here (opened in another browser than the
  // one that signed up: the PKCE verifier is a cookie there) has still
  // confirmed the email. Say so, and keep where they were going.
  const login = new URL("/login", origin);
  if (code && flow === "signup") login.searchParams.set("notice", "confirmed");
  else login.searchParams.set("error", "auth_callback_error");
  if (next) login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}
