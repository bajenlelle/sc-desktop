import { describe, expect, it } from "vitest";
import {
  GAME_VIDEO_MAX_BYTES,
  GAME_VIDEO_PART_SIZE,
  bareEtag,
  completeMultipartXml,
  gameVideoKey,
  isGameVideoKey,
  isSignedUrlFresh,
  isValidKeyPrefix,
  missingParts,
  parseListParts,
  partRange,
  partsComplete,
  planParts,
  projectRefFromUrl,
  s3ErrorCode,
} from "../game-video-wire";

const GB = 1000 * 1000 * 1000;

describe("planParts", () => {
  it("splits a game into equal 32 MiB parts, the last one shorter", () => {
    const plan = planParts(3 * GB);
    expect(plan.partSize).toBe(GAME_VIDEO_PART_SIZE);
    expect(plan.count).toBe(Math.ceil((3 * GB) / GAME_VIDEO_PART_SIZE));
    expect(plan.count).toBe(90);
    const last = partRange(plan.count, plan, 3 * GB);
    expect(last.offset).toBe((plan.count - 1) * GAME_VIDEO_PART_SIZE);
    expect(last.length).toBe(3 * GB - last.offset);
    expect(last.length).toBeLessThan(GAME_VIDEO_PART_SIZE);
    expect(partRange(1, plan, 3 * GB)).toEqual({ offset: 0, length: GAME_VIDEO_PART_SIZE });
  });

  it("a small file is one part of its own size", () => {
    expect(planParts(1234)).toEqual({ partSize: GAME_VIDEO_PART_SIZE, count: 1 });
    expect(partRange(1, planParts(1234), 1234)).toEqual({ offset: 0, length: 1234 });
  });

  it("refuses sizes over the cap and nonsense sizes", () => {
    expect(() => planParts(GAME_VIDEO_MAX_BYTES + 1)).toThrow("too_large");
    expect(() => planParts(0)).toThrow("invalid_size");
    expect(() => planParts(-5)).toThrow("invalid_size");
    expect(() => planParts(1.5)).toThrow("invalid_size");
    expect(() => planParts(Number.NaN)).toThrow("invalid_size");
    expect(() => partRange(0, planParts(100), 100)).toThrow("invalid_part");
    expect(() => partRange(2, planParts(100), 100)).toThrow("invalid_part");
  });
});

describe("parts bookkeeping", () => {
  it("lists what is still missing, in order", () => {
    expect(missingParts(5, [{ partNumber: 2 }, { partNumber: 4 }])).toEqual([1, 3, 5]);
    expect(missingParts(3, [])).toEqual([1, 2, 3]);
    expect(missingParts(2, [{ partNumber: 1 }, { partNumber: 2 }])).toEqual([]);
  });

  it("knows a complete set from a broken one", () => {
    const ok = [
      { partNumber: 2, etag: "b" },
      { partNumber: 1, etag: "a" },
    ];
    expect(partsComplete(ok, 2)).toBe(true);
    expect(partsComplete(ok, 3)).toBe(false);
    expect(partsComplete([{ partNumber: 1, etag: "a" }, { partNumber: 1, etag: "a" }], 2)).toBe(false);
    expect(partsComplete([{ partNumber: 1, etag: "" }], 1)).toBe(false);
    expect(partsComplete([{ partNumber: 0, etag: "a" }], 1)).toBe(false);
  });
});

describe("keys", () => {
  it("reads the project ref out of a Supabase URL and nothing else", () => {
    expect(projectRefFromUrl("https://edalihizooqdxeekaklf.supabase.co")).toBe("edalihizooqdxeekaklf");
    expect(projectRefFromUrl("https://nbmrujmazvdoaldirpyx.supabase.co/")).toBe("nbmrujmazvdoaldirpyx");
    expect(projectRefFromUrl("http://kong:8000")).toBeNull();
    expect(projectRefFromUrl("https://example.com/edalihizooqdxeekaklf.supabase.co")).toBeNull();
    expect(projectRefFromUrl("https://evil.supabase.co.attacker.net")).toBeNull();
    expect(projectRefFromUrl("")).toBeNull();
  });

  it("builds and recognises keys under exactly one prefix", () => {
    const id = "0f4d1b2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
    const key = gameVideoKey("edalihizooqdxeekaklf", "2583394", id);
    expect(key).toBe(`edalihizooqdxeekaklf/games/2583394/${id}.mp4`);
    expect(isGameVideoKey(key, "edalihizooqdxeekaklf")).toBe(true);
    expect(isGameVideoKey(key, "nbmrujmazvdoaldirpyx")).toBe(false);
    expect(isGameVideoKey(gameVideoKey("p1", "demo-5dc28ee0-0186-4ca5-9e8d-9023d4794a92", id), "p1")).toBe(true);
    expect(isGameVideoKey(`p1/games/../${id}.mp4`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1/games/m/not-a-uuid.mp4`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1/games/m/${id}.mov`, "p1")).toBe(false);
    expect(isGameVideoKey(`p1x/games/m/${id}.mp4`, "p1")).toBe(false);
    expect(isGameVideoKey(key, "")).toBe(false);
  });

  it("accepts only ref-like prefixes", () => {
    expect(isValidKeyPrefix("edalihizooqdxeekaklf")).toBe(true);
    expect(isValidKeyPrefix("staging-2")).toBe(true);
    expect(isValidKeyPrefix("")).toBe(false);
    expect(isValidKeyPrefix("Has/Slash")).toBe(false);
    expect(isValidKeyPrefix("-leading")).toBe(false);
  });
});

describe("S3 multipart XML", () => {
  it("parses ListParts as S3 writes it: quoted, escaped ETags, any child order", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListPartsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Bucket>scoutable-game-videos</Bucket>
  <IsTruncated>false</IsTruncated>
  <Part>
    <ETag>&quot;7778aef83f66abc1fa1e8477f296d394&quot;</ETag>
    <LastModified>2026-10-19T10:00:00.000Z</LastModified>
    <PartNumber>2</PartNumber>
    <Size>33554432</Size>
  </Part>
  <Part>
    <PartNumber>1</PartNumber>
    <ETag>"a54357aff0632cce46d942af68356b38"</ETag>
    <Size>33554432</Size>
  </Part>
</ListPartsResult>`;
    expect(parseListParts(xml)).toEqual({
      parts: [
        { partNumber: 1, etag: "a54357aff0632cce46d942af68356b38" },
        { partNumber: 2, etag: "7778aef83f66abc1fa1e8477f296d394" },
      ],
      nextPartNumberMarker: null,
    });
  });

  it("reports a truncated listing's marker, and an empty listing", () => {
    const xml = `<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>1000</NextPartNumberMarker>
      <Part><PartNumber>1</PartNumber><ETag>&quot;x&quot;</ETag></Part></ListPartsResult>`;
    expect(parseListParts(xml).nextPartNumberMarker).toBe(1000);
    expect(parseListParts("<ListPartsResult><IsTruncated>false</IsTruncated></ListPartsResult>")).toEqual({
      parts: [],
      nextPartNumberMarker: null,
    });
  });

  it("writes CompleteMultipartUpload in part order with quoted ETags", () => {
    const xml = completeMultipartXml([
      { partNumber: 2, etag: '"bbb"' },
      { partNumber: 1, etag: "aaa" },
    ]);
    expect(xml).toBe(
      '<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
        "<Part><PartNumber>1</PartNumber><ETag>&quot;aaa&quot;</ETag></Part>" +
        "<Part><PartNumber>2</PartNumber><ETag>&quot;bbb&quot;</ETag></Part>" +
        "</CompleteMultipartUpload>",
    );
  });

  it("strips quotes from ETags and reads S3 error codes", () => {
    expect(bareEtag('"abc-2"')).toBe("abc-2");
    expect(bareEtag(" abc ")).toBe("abc");
    expect(bareEtag('W/"abc"')).toBe("abc");
    expect(s3ErrorCode("<Error><Code>NoSuchUpload</Code><Message>x</Message></Error>")).toBe("NoSuchUpload");
    expect(s3ErrorCode("not xml")).toBeNull();
  });
});

describe("isSignedUrlFresh", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("is fresh with more than the margin left, stale inside it", () => {
    expect(isSignedUrlFresh("2026-10-19T23:00:00Z", now)).toBe(true);
    expect(isSignedUrlFresh("2026-10-19T12:05:00Z", now)).toBe(false);
    expect(isSignedUrlFresh("2026-10-19T11:00:00Z", now)).toBe(false);
    expect(isSignedUrlFresh(now + 11 * 60 * 1000, now)).toBe(true);
    expect(isSignedUrlFresh(now + 11 * 60 * 1000, now, 15 * 60)).toBe(false);
  });
  it("treats garbage as stale", () => {
    expect(isSignedUrlFresh("soon", now)).toBe(false);
  });
});
