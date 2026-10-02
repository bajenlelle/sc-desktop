import { describe, expect, it } from "vitest";
import { classifyMediaError, mediaFailureMessage, type MediaFailure } from "../media-failure";

const KINDS: MediaFailure[] = ["unsupported", "no_picture", "unavailable"];

describe("classifyMediaError", () => {
  it("maps MEDIA_ERR_SRC_NOT_SUPPORTED (4) to an unsupported format", () => {
    expect(classifyMediaError(4)).toBe("unsupported");
  });

  it("treats every other code, and a missing one, as the file being unavailable", () => {
    for (const code of [1, 2, 3]) expect(classifyMediaError(code), String(code)).toBe("unavailable");
    expect(classifyMediaError(null)).toBe("unavailable");
    expect(classifyMediaError(undefined)).toBe("unavailable");
  });
});

describe("mediaFailureMessage", () => {
  it("states the problem, then what to do, for every kind", () => {
    for (const kind of KINDS) {
      const msg = mediaFailureMessage(kind);
      expect(msg, kind).toMatch(/\. /); // two sentences: problem, then fix
      expect(msg, kind).toMatch(/Convert it to MP4|Check that the file/);
    }
  });

  it("tells a no-picture user it is the codec, not a missing file", () => {
    expect(mediaFailureMessage("no_picture")).toMatch(/codec/i);
    expect(mediaFailureMessage("no_picture")).not.toMatch(/exists/);
  });

  it("tells a viewer of a remote clip to check the connection, not a file", () => {
    const msg = mediaFailureMessage("unavailable", { remote: true });
    expect(msg).toMatch(/connection/i);
    expect(msg).not.toMatch(/file/i);
  });

  it("never apologises or shouts", () => {
    for (const kind of KINDS) {
      const msg = mediaFailureMessage(kind);
      expect(msg).not.toMatch(/sorry|oops/i);
      expect(msg).not.toContain("!");
    }
  });
});
