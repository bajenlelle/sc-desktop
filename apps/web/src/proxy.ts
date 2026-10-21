import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Set once check_onboarding_needed has answered "has an org" for this user. */
const ORG_OK_COOKIE = "sc_org_ok";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Sentry browser events tunnel through this route (next.config.ts
  // `tunnelRoute`) — pass them straight through, no session work or redirects.
  if (pathname.startsWith("/monitoring")) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — must not run any code between createServerClient and getClaims().
  // getClaims() verifies the access token against the project's signing keys
  // locally (ES256, cached JWKS) instead of calling Supabase Auth on every
  // request like getUser() does; it still refreshes an expiring session. The
  // trade-off: a banned or globally signed-out user passes this routing guard
  // until their token expires (<= 1 h). Data access is unaffected, RLS
  // enforces it on every query.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  const user = userId ? { id: userId } : null;

  // Redirect unauthenticated users away from app routes
  const isAppRoute =
    pathname.startsWith("/my-playlists") ||
    pathname.startsWith("/organization") ||
    pathname.startsWith("/profile") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/onboarding");

  if (!user && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/my-playlists";
    return NextResponse.redirect(url);
  }

  // Redirect root to playlists or login
  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = user ? "/my-playlists" : "/login";
    return NextResponse.redirect(url);
  }

  // Onboarding guard: authenticated users without an org must go to /onboarding.
  // Done here (not in layout) so Next.js issues a real HTTP redirect, not a soft
  // client-router redirect that skips re-running the shared layout.
  if (user && !pathname.startsWith("/onboarding") && !pathname.startsWith("/view/") && !pathname.startsWith("/join/") && !pathname.startsWith("/h/") && !pathname.startsWith("/unsubscribe") && !pathname.startsWith("/api/unsubscribe")) {
    // Once a user is known to have an org the answer rarely changes, so it is
    // remembered for a day instead of asked on every navigation. Bound to the
    // user id so a different account on the same browser asks again. The
    // cost: someone removed from their last org reaches the app for up to a
    // day before being sent to /onboarding.
    if (request.cookies.get(ORG_OK_COOKIE)?.value !== user.id) {
      const { data: needsOnboarding } = await supabase.rpc("check_onboarding_needed");
      if (needsOnboarding) {
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding";
        return NextResponse.redirect(url);
      }
      if (needsOnboarding === false) {
        supabaseResponse.cookies.set(ORG_OK_COOKIE, user.id, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24,
        });
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    {
      // Static files skip the session work.
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      // So do link prefetches (every sidebar link, on every page): the (app)
      // layout still checks the session, and the navigation itself comes
      // through here for the redirects.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
