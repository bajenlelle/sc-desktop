import { describe, expect, it } from "vitest";
import { releaseNoteLines, whatsNewUrl } from "../release-notes";

describe("releaseNoteLines", () => {
  it("reads a tag message as lines, bullets as bullets", () => {
    expect(releaseNoteLines("The scouting report is its own page.\n\n- Pick players from the leaders\n* Notes typed in place\n")).toEqual([
      { kind: "text", text: "The scouting report is its own page." },
      { kind: "bullet", text: "Pick players from the leaders" },
      { kind: "bullet", text: "Notes typed in place" },
    ]);
  });

  it("drops Markdown heading marks and emphasis, and blank lines", () => {
    expect(releaseNoteLines("## What's new\n\n**Scouting report** has its own page\r\n\n")).toEqual([
      { kind: "text", text: "What's new" },
      { kind: "text", text: "Scouting report has its own page" },
    ]);
  });

  it("is empty for no notes", () => {
    expect(releaseNoteLines(undefined)).toEqual([]);
    expect(releaseNoteLines(" \n ")).toEqual([]);
  });
});

describe("whatsNewUrl", () => {
  it("tags the page with where it was opened from", () => {
    expect(whatsNewUrl("help_menu")).toBe("https://scoutable.se/whats-new?utm_source=desktop&utm_medium=help_menu");
  });

  it("opens at a version's notes, with or without its v", () => {
    expect(whatsNewUrl("update_card", "2.0.0")).toBe("https://scoutable.se/whats-new?utm_source=desktop&utm_medium=update_card#v2.0.0");
    expect(whatsNewUrl("update_card", "v2.1.0")).toBe("https://scoutable.se/whats-new?utm_source=desktop&utm_medium=update_card#v2.1.0");
  });
});
