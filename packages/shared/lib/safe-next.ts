/**
 * The `next` parameter that the sign-in, sign-up and auth callback pages
 * redirect to afterwards. It comes from the URL, so anyone can put anything
 * there: only a path on this site is allowed through. `//host` and `/\host`
 * are protocol-relative URLs to a browser, and `${origin}@host` reads the
 * origin as credentials, so a path must start with a single `/` followed by
 * something that isn't a slash or backslash.
 */
const MAX_LENGTH = 2048;

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null;
  if (!/^\/(?![/\\])/.test(raw)) return null;
  // eslint-disable-next-line no-control-regex -- control characters and whitespace have no place in a path
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}
