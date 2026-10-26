import { describe, expect, it } from "vitest";
import { releaseNoteLines } from "../release-notes";

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
