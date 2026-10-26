/** Where the auth pages send someone when nothing says otherwise. */
export const DEFAULT_NEXT = "/my-playlists";

/**
 * `href` with `?next=` added, so a sign-in, sign-up or reset link keeps
 * where the person was going (an invite, say). The default landing page
 * isn't worth carrying.
 */
export function withNext(href: string, next: string | null | undefined): string {
  if (!next || next === DEFAULT_NEXT) return href;
  return `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
}
