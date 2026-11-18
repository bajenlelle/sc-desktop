// Pure helpers for the genius edge function's roster sync: a Genius person →
// a league_players row, and where its photo goes in the media bucket. No I/O
// and no imports: the Deno function imports this file directly.

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;

/** The photo sizes Genius serves and we copy: 75, 200, 400 and 600 px. */
export const PHOTO_SIZES = ["T1", "S1", "M1", "L1"] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];

const HASH_RE = /\/([0-9a-f]{16,64})(T1|S1|M1|L1)\.(jpg|jpeg|png)$/i;

/** The image hash in a Genius photo URL (…/c117…e6S1.jpg → c117…e6), or null. */
export function photoHash(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = HASH_RE.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/** The person's photo URL per size, from `images.photo`; empty when they have none. */
export function photoUrls(p: Json): Partial<Record<PhotoSize, string>> {
  const out: Partial<Record<PhotoSize, string>> = {};
  const photo = p?.images?.photo;
  if (!photo || typeof photo !== "object") return out;
  for (const size of PHOTO_SIZES) {
    const url = photo[size]?.url;
    if (typeof url === "string" && url.startsWith("https://")) out[size] = url;
  }
  return out;
}

/** R2 key of one size of a person's photo. */
export function photoKey(source: string, personId: string, hash: string, size: PhotoSize): string {
  return `players/${source}/${personId}/${hash}-${size}.jpg`;
}

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** A positive whole number within [min, max], else null (Genius sends 0 for unknown). */
function measure(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n);
}

/** "2004-03-07", "2004-03-07 00:00:00" or "2004-03-07T00:00:00Z" → "2004-03-07". */
function isoDate(v: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m || m[1] === "0000" || m[1] < "1900") return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface PersonRow {
  source: "genius";
  source_person_id: string;
  first_name: string;
  family_name: string;
  default_shirt_number: string | null;
  playing_position: string | null;
  dob: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  nationality: string | null;
  nationality_code: string | null;
}

/**
 * A roster person → the league_players columns we keep. Social links, licence
 * numbers and custom values are dropped on purpose.
 */
export function trimPerson(p: Json): PersonRow | null {
  const id = p?.personId;
  if (id == null || !/^\d+$/.test(String(id))) return null;
  return {
    source: "genius",
    source_person_id: String(id),
    first_name: text(p.firstName) ?? "",
    family_name: text(p.familyName) ?? "",
    default_shirt_number: text(p.defaultShirtNumber),
    playing_position: text(p.defaultPlayingPosition),
    dob: isoDate(p.dob),
    height_cm: measure(p.height, 100, 250),
    weight_kg: measure(p.weight, 30, 200),
    nationality: text(p.nationality),
    nationality_code: text(p.nationalityCode),
  };
}

/** The shirt number for this team-season: the competition entry's, else the default. */
export function rosterShirt(p: Json): string | null {
  const cp = p?.competition_player;
  return text(cp?.shirtNumber) ?? text(p?.defaultShirtNumber);
}
