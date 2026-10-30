/** The longest name a profile keeps; the web and desktop fields set none, so this is the mobile field's cap. */
export const FULL_NAME_MAX = 80;

/**
 * A name as it is saved: trimmed, runs of whitespace folded into one space,
 * cut at FULL_NAME_MAX. Null when nothing is left, so a blank field is never
 * saved over a name.
 */
export function normalizeFullName(input: string): string | null {
  const name = input.replace(/\s+/g, " ").trim().slice(0, FULL_NAME_MAX).trimEnd();
  return name.length > 0 ? name : null;
}
