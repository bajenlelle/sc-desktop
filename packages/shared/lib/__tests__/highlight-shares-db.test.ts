import { describe, expect, it } from "vitest";
import { highlightShareKeys } from "../highlight-shares-db";

// Golden test: live R2 objects are addressed by these keys, and the
// Cloudflare lifecycle rule + GDPR delete sweep match on the
// highlights/{userId}/ prefix. Changing the shape breaks existing links.
describe("highlightShareKeys", () => {
  it("puts the poster beside the video under the user's highlights prefix", () => {
    expect(highlightShareKeys("user-1", "share-a")).toEqual({
      video: "highlights/user-1/share-a.mp4",
      poster: "highlights/user-1/share-a.jpg",
    });
  });
});
