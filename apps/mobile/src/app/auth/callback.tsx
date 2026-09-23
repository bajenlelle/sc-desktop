import { Redirect } from "expo-router";

/**
 * Absorbs the OAuth redirect (scoutable://auth/callback).
 *
 * On Android the redirect comes back as a real deep link: Chrome hands
 * scoutable://auth/callback to MainActivity, so expo-router tries to navigate
 * to /auth/callback. Without this file that is an Unmatched Route rendered on
 * top of a session that was, in fact, created — the sign-in worked, the 404
 * just sat in front of it. iOS never gets here: ASWebAuthenticationSession
 * consumes the redirect in-process, and Apple sign-in there is native anyway.
 *
 * Deliberately does NOT exchange the code. signInWithProvider already did, and
 * an authorization code is single-use — a second exchange would fail and could
 * tear down the session that just succeeded. So this only hands control back to
 * the dispatcher. If the exchange hasn't finished yet, index sends to sign-in
 * and (auth)/_layout redirects to / the moment the session lands.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
