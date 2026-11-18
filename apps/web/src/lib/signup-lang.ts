/**
 * Language the landing page was in when the visitor chose to sign up. It
 * rides along on the account (`user_metadata.lang`) so the confirm and
 * welcome emails can be sent in it. Anything else is ignored.
 */
export type SignupLang = "sv" | "en";

/** Carries the language across the OAuth round trip to /auth/callback. */
export const SIGNUP_LANG_COOKIE = "sc_signup_lang";

export function parseSignupLang(v: string | null): SignupLang | null {
  return v === "sv" || v === "en" ? v : null;
}
