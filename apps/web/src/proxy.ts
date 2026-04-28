import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  // Refresh session — must not run any code between createServerClient and getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  if (user && !pathname.startsWith("/onboarding") && !pathname.startsWith("/view/") && !pathname.startsWith("/join/")) {
    const { data: needsOnboarding } = await supabase.rpc("check_onboarding_needed");
    if (needsOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
