/**
 * When the desktop's periodic update check may bring the sidebar's update
 * card back. Dismissing the card hides that version for the rest of the
 * session; a newer release brings it back. The startup check and a check the
 * coach asks for (Settings, the app menu) always show what they find, so they
 * don't go through here.
 */

/** How often the running app looks for a release. */
export const UPDATE_RECHECK_MS = 4 * 60 * 60_000;

/**
 * Orders two release versions ("1.10.0", "v1.9.2") by their numeric parts.
 * A part that isn't a number counts as 0, and a missing part as 0, so
 * "1.10" equals "1.10.0". Negative when a is older than b.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Whether a release the periodic check found should show the card:
 * not while the card is already up (or an install is running), and not for
 * the version the coach dismissed or an older one.
 */
export function shouldOfferFoundUpdate(input: {
  found: string;
  showing: boolean;
  dismissed: string | null;
}): boolean {
  if (input.showing) return false;
  if (input.dismissed === null) return true;
  return compareVersions(input.found, input.dismissed) > 0;
}
