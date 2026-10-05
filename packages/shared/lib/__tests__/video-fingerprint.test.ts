import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_OFFSETS_S,
  canonicalFingerprintString,
  dhashFromGray9x8,
  fingerprintKey,
  fingerprintOffsetsFor,
  hammingHex,
  isFingerprintMatch,
} from "../video-fingerprint";

describe("fingerprintOffsetsFor", () => {
  it("uses every fixed offset that fits under duration − 5 s", () => {
    expect(fingerprintOffsetsFor(7112)).toEqual([...FINGERPRINT_OFFSETS_S]);
    expect(fingerprintOffsetsFor(2405)).toEqual([30, 90, 180, 300, 600, 900, 1500]);
    expect(fingerprintOffsetsFor(2704)).toEqual([30, 90, 180, 300, 600, 900, 1500]);
    expect(fingerprintOffsetsFor(2705)).toEqual([...FINGERPRINT_OFFSETS_S]);
  });

  it("falls back to the midpoint of a very short file", () => {
    expect(fingerprintOffsetsFor(20)).toEqual([10]);
    expect(fingerprintOffsetsFor(34)).toEqual([17]);
  });
});

describe("dhashFromGray9x8", () => {
  const rows = (fn: (col: number, row: number) => number) => {
    const px = new Uint8Array(72);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 9; c++) px[r * 9 + c] = fn(c, r);
    return px;
  };

  it("sets a bit where the left pixel is brighter than its right neighbour", () => {
    expect(dhashFromGray9x8(rows((c) => 255 - c * 20))).toBe("ffffffffffffffff");
    expect(dhashFromGray9x8(rows((c) => c * 20))).toBe("0000000000000000");
    expect(dhashFromGray9x8(rows(() => 128))).toBe("0000000000000000");
  });

  it("is deterministic and 16 hex chars", () => {
    const px = rows((c, r) => (c * 31 + r * 17) % 256);
    const a = dhashFromGray9x8(px);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(dhashFromGray9x8(px)).toBe(a);
  });

  it("rejects anything but 72 bytes", () => {
    expect(() => dhashFromGray9x8(new Uint8Array(71))).toThrow();
  });
});

describe("hammingHex", () => {
  it("counts differing bits", () => {
    expect(hammingHex("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hammingHex("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hammingHex("0000000000000001", "0000000000000003")).toBe(1);
  });

  it("refuses mismatched lengths", () => {
    expect(() => hammingHex("ff", "fff")).toThrow();
  });
});

describe("fingerprint key", () => {
  it("pins the canonical string format", () => {
    expect(canonicalFingerprintString(7112457, ["aa", "bb"])).toBe("v1|7112|aa,bb");
  });

  it("is a deterministic sha256 hex", async () => {
    const a = await fingerprintKey(7112457, ["aa", "bb"]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintKey(7112457, ["aa", "bb"])).toBe(a);
    expect(await fingerprintKey(7112457, ["aa", "bc"])).not.toBe(a);
  });
});

describe("isFingerprintMatch", () => {
  const eight = (d: number) => Array(8).fill(d);

  it("accepts close hashes with the same duration", () => {
    expect(isFingerprintMatch(eight(3), 0)).toBe(true);
    expect(isFingerprintMatch(eight(10), 4999)).toBe(true);
  });

  it("rejects a duration gap over the tolerance", () => {
    expect(isFingerprintMatch(eight(0), 6000)).toBe(false);
    expect(isFingerprintMatch(eight(0), -6000)).toBe(false);
  });

  it("needs three quarters of the compared hashes to be close", () => {
    expect(isFingerprintMatch([0, 0, 0, 0, 0, 30, 30, 30], 0)).toBe(false);
    expect(isFingerprintMatch([0, 0, 0, 0, 0, 0, 30, 30], 0)).toBe(true);
  });

  it("needs at least three samples", () => {
    expect(isFingerprintMatch([0, 0], 0)).toBe(false);
    expect(isFingerprintMatch([], 0)).toBe(false);
    expect(isFingerprintMatch([0, 0, 0], 0)).toBe(true);
  });
});
