import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { presignUpload } from "../presign-upload-client";
import { clipShipKey } from "../clip-timing";
import { highlightShareKeys } from "../highlight-shares-db";

function mockClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn().mockResolvedValue(result);
  const client = { functions: { invoke } } as unknown as SupabaseClient;
  return { client, invoke };
}

describe("presignUpload", () => {
  it("invokes presign-upload with the key/contentType body and returns the presigned pair", async () => {
    const data = {
      uploadUrl: "https://r2.example.com/bucket/clips/m1/42_pre5.0_post3.0.mp4?X-Amz-Expires=900",
      publicUrl: "https://media.scoutable.se/clips/m1/42_pre5.0_post3.0.mp4",
    };
    const { client, invoke } = mockClient({ data, error: null });

    const out = await presignUpload(client, "clips/m1/42_pre5.0_post3.0.mp4", "video/mp4");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("presign-upload", {
      body: { key: "clips/m1/42_pre5.0_post3.0.mp4", contentType: "video/mp4" },
    });
    expect(out).toEqual({ ok: true, data });
  });

  it("surfaces the snake token from the error context body", async () => {
    const { client } = mockClient({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: "not_authorized" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      },
    });

    const out = await presignUpload(client, "clips/m1/42_pre5.0_post3.0.mp4", "video/mp4");
    expect(out).toEqual({ ok: false, error: "not_authorized" });
  });

  it("falls back to request_failed when the context body is not JSON", async () => {
    const { client } = mockClient({
      data: null,
      error: { context: new Response("<html>bad gateway</html>", { status: 502 }) },
    });

    const out = await presignUpload(client, "clips/m1/42_pre5.0_post3.0.mp4", "video/mp4");
    expect(out).toEqual({ ok: false, error: "request_failed" });
  });

  it("falls back to request_failed when the error has no context (network error)", async () => {
    const { client } = mockClient({
      data: null,
      error: { message: "Failed to send a request to the Edge Function" },
    });

    const out = await presignUpload(client, "clips/m1/42_pre5.0_post3.0.mp4", "video/mp4");
    expect(out).toEqual({ ok: false, error: "request_failed" });
  });

  it("falls back to request_failed when the context JSON has no error field", async () => {
    const { client } = mockClient({
      data: null,
      error: { context: new Response(JSON.stringify({}), { status: 500 }) },
    });

    const out = await presignUpload(client, "clips/m1/42_pre5.0_post3.0.mp4", "video/mp4");
    expect(out).toEqual({ ok: false, error: "request_failed" });
  });
});

// Copied VERBATIM from supabase/functions/presign-upload/index.ts — the edge
// function validates every submitted key against these before signing. They
// must stay in sync with the key builders below (clipShipKey /
// highlightShareKeys); if either side changes, this suite is the tripwire.
const CLIP_KEY = /^clips\/([A-Za-z0-9-]{1,64})\/\d{1,12}_pre\d{1,4}\.\d_post\d{1,4}\.\d\.mp4$/;
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const HIGHLIGHT_KEY = new RegExp(`^highlights/(${UUID})/${UUID}\\.(mp4|jpg)$`);

describe("edge-function key regexes accept what the shared builders produce", () => {
  it("CLIP_KEY matches every clipShipKey shape in the wild", () => {
    // Legacy short id, Genius numeric id, demo id, big rolls, eventId 0.
    expect(clipShipKey("m1", 42, 5, 3)).toMatch(CLIP_KEY);
    expect(clipShipKey("2537281", 118, 5, 3)).toMatch(CLIP_KEY);
    expect(clipShipKey("demo-123e4567-e89b-12d3-a456-426614174000", 7, 5, 3)).toMatch(CLIP_KEY);
    expect(clipShipKey("m1", 7, 999, 12.5)).toMatch(CLIP_KEY); // → pre999.0_post12.5
    expect(clipShipKey("m1", 0, 5, 3)).toMatch(CLIP_KEY);
  });

  it("CLIP_KEY captures the matchId for the authorization lookup", () => {
    const m = CLIP_KEY.exec(clipShipKey("demo-123e4567-e89b-12d3-a456-426614174000", 7, 5, 3));
    expect(m?.[1]).toBe("demo-123e4567-e89b-12d3-a456-426614174000");
  });

  it("CLIP_KEY rejects malformed and hostile keys", () => {
    expect("clips/../evil.mp4").not.toMatch(CLIP_KEY); // path traversal
    expect("clips/m1/42_pre5_post3.mp4").not.toMatch(CLIP_KEY); // missing decimals
    expect("clips/m1/extra/42_pre5.0_post3.0.mp4").not.toMatch(CLIP_KEY); // second slash
    expect("clips/m1/42_pre5.0_post3.0.MP4").not.toMatch(CLIP_KEY); // uppercase ext
    expect("clips/m1/42_pre5.0_post3.0.mp4.exe").not.toMatch(CLIP_KEY); // trailing garbage
  });

  it("HIGHLIGHT_KEY matches both highlightShareKeys outputs for real UUIDs", () => {
    const uid = "123e4567-e89b-12d3-a456-426614174000";
    const shareId = "9b2e8a10-77cd-4f1e-8a00-abcdefabcdef";
    const { video, poster } = highlightShareKeys(uid, shareId);
    expect(video).toMatch(HIGHLIGHT_KEY);
    expect(poster).toMatch(HIGHLIGHT_KEY);
    // The captured uid is what the function compares against auth.uid().
    expect(HIGHLIGHT_KEY.exec(video)?.[1]).toBe(uid);
  });

  it("HIGHLIGHT_KEY rejects non-uuid uids, foreign extensions, and extra segments", () => {
    const uid = "123e4567-e89b-12d3-a456-426614174000";
    const shareId = "9b2e8a10-77cd-4f1e-8a00-abcdefabcdef";
    // highlightShareKeys itself accepts any string (see its golden test) —
    // only the edge function pins uids to UUIDs.
    expect(highlightShareKeys("user-1", shareId).video).not.toMatch(HIGHLIGHT_KEY);
    expect(`highlights/${uid}/${shareId}.png`).not.toMatch(HIGHLIGHT_KEY);
    expect(`highlights/${uid}/extra/${shareId}.mp4`).not.toMatch(HIGHLIGHT_KEY);
  });
});
