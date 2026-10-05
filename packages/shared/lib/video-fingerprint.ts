/**
 * Content fingerprint of a game recording: its duration plus a 64-bit dHash of
 * the frame at a few fixed absolute offsets. Two downloads of the same stream
 * (any rendition or re-encode) match; a copy that starts later does not, because
 * both the sampled content and the duration shift. Measured on real files:
 * same recording re-encoded to 480p → per-hash distance 1–5; start-trimmed by
 * 20 s → 8–27; a different game → 25–44.
 *
 * Pure and isomorphic. The desktop produces the 9×8 grey thumbnails with the
 * ffmpeg sidecar (`scale=9:8:flags=area,format=gray`), the hashing happens here.
 */

export const FINGERPRINT_VERSION = 1;

/** Seconds into the recording that are hashed (those that fit under duration − 5 s). */
export const FINGERPRINT_OFFSETS_S = [30, 90, 180, 300, 600, 900, 1500, 2700] as const;

export const HINT_MATCH = {
  maxDurationDeltaMs: 5000,
  perHashMax: 10,
  minMatchingFraction: 0.75,
  minSamples: 3,
} as const;

export interface VideoFingerprint {
  version: typeof FINGERPRINT_VERSION;
  durationMs: number;
  offsetsS: number[];
  /** One 16-char lowercase hex dHash per offset, same order. */
  hashes: string[];
  /** sha256 of the canonical string; per-file identity used for idempotent writes only. */
  key: string;
}

export function fingerprintOffsetsFor(durationS: number): number[] {
  const fit = FINGERPRINT_OFFSETS_S.filter((o) => o <= durationS - 5);
  return fit.length > 0 ? [...fit] : [Math.floor(durationS / 2)];
}

/** 72 grey bytes, 9 columns × 8 rows, row-major → 64 bits: bit = left pixel brighter than its right neighbour. */
export function dhashFromGray9x8(px: Uint8Array): string {
  if (px.length !== 72) throw new Error("dhash needs 72 grey bytes (9×8)");
  let hex = "";
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) {
      const a = px[row * 9 + col];
      const b = px[row * 9 + col + 1];
      byte = (byte << 1) | (a > b ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hash length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function canonicalFingerprintString(durationMs: number, hashes: string[]): string {
  return `v${FINGERPRINT_VERSION}|${Math.round(durationMs / 1000)}|${hashes.join(",")}`;
}

export async function fingerprintKey(durationMs: number, hashes: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalFingerprintString(durationMs, hashes));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Match rule over the per-offset distances of the common prefix. */
export function isFingerprintMatch(distances: number[], durationDeltaMs: number, m = HINT_MATCH): boolean {
  if (Math.abs(durationDeltaMs) > m.maxDurationDeltaMs) return false;
  if (distances.length < m.minSamples) return false;
  const close = distances.filter((d) => d <= m.perHashMax).length;
  return close / distances.length >= m.minMatchingFraction;
}
