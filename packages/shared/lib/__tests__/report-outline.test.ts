import { describe, expect, it } from "vitest";
import { LEFT_OUT, TEAM_SECTION, addSections, deriveReportLayout, emptyDraft } from "../report-draft";
import { clipDrop, outlineRows, sectionDropIndex, sectionGap, sectionRowKey, snapClipGap } from "../report-outline";
import type { StatsCardPlayer } from "../stats-card";
import type { PlayByPlayEvent, PlaylistClipItem } from "../../types/match";

const ALVA: StatsCardPlayer = { id: "1", name: "Alva Berg", number: "7", teamId: "10", teamName: "AIK" };
const OLA: StatsCardPlayer = { id: "2", name: "Ola Nilsson", number: "12", teamId: "10", teamName: "AIK" };

function event(eventId: number, pid: number | null): PlayByPlayEvent {
  return {
    eventId,
    type: "2pt",
    subType: "",
    period: 1,
    gameClockTime: "05:00:00",
    realWorldTime: "2026-10-12T17:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    player: pid === null ? undefined : { playerId: pid, pno: 1, firstName: "x", familyName: "y", teamNumber: 1 },
  } as PlayByPlayEvent;
}

const clip = (eventId: number): PlaylistClipItem => ({ type: "clip", matchId: "m1", eventId });
const events = new Map<string, PlayByPlayEvent>([
  ["m1:1", event(1, 1)],
  ["m1:2", event(2, 1)],
  ["m1:3", event(3, 2)],
  ["m1:4", event(4, null)],
  ["m1:5", event(5, null)],
]);

let n = 0;
const draft = addSections(emptyDraft(), [ALVA, OLA], () => `s${++n}`);
// Team: m1:4, m1:5 · s1 (Alva): m1:1, m1:2 · s2 (Ola): m1:3 · Not in report: none
const layout = deriveReportLayout(draft, [clip(3), clip(1), clip(4), clip(2), clip(5)], events, { keepTeam: true });
const keys = (rows: { key: string }[]) => rows.map((r) => r.key);

describe("outlineRows", () => {
  it("lists every section's header and clips, the team first and the left-out group last", () => {
    expect(keys(outlineRows(layout, new Set()))).toEqual([
      sectionRowKey(TEAM_SECTION), "m1:4", "m1:5",
      sectionRowKey("s1"), "m1:1", "m1:2",
      sectionRowKey("s2"), "m1:3",
      sectionRowKey(LEFT_OUT),
    ]);
  });

  it("shows only the header of a collapsed section", () => {
    const rows = outlineRows(layout, new Set(["s1"]));
    expect(keys(rows)).toEqual([sectionRowKey(TEAM_SECTION), "m1:4", "m1:5", sectionRowKey("s1"), sectionRowKey("s2"), "m1:3", sectionRowKey(LEFT_OUT)]);
    expect(rows[3]).toEqual({ key: sectionRowKey("s1"), kind: "section", id: "s1" });
    expect(rows[1]).toEqual({ key: "m1:4", kind: "clip", id: TEAM_SECTION, clipKey: "m1:4" });
  });
});

describe("dropping clips", () => {
  const rows = outlineRows(layout, new Set());
  // 0 Team · 1 m1:4 · 2 m1:5 · 3 Alva · 4 m1:1 · 5 m1:2 · 6 Ola · 7 m1:3 · 8 Not in report

  it("lands in the section above the gap, before the next clip of that section", () => {
    expect(clipDrop(rows, ["m1:3"], 4)).toEqual({ to: "s1", before: "m1:1" });
    expect(clipDrop(rows, ["m1:3"], 1)).toEqual({ to: TEAM_SECTION, before: "m1:4" });
  });

  it("lands at the end of a section from the gap above the next header", () => {
    expect(clipDrop(rows, ["m1:3"], 6)).toEqual({ to: "s1", before: null });
    expect(clipDrop(rows, ["m1:1"], 9)).toEqual({ to: LEFT_OUT, before: null });
  });

  it("skips the dragged clips themselves when finding the clip to land before", () => {
    expect(clipDrop(rows, ["m1:1"], 4)).toEqual({ to: "s1", before: "m1:2" });
    expect(clipDrop(rows, ["m1:1", "m1:2"], 4)).toEqual({ to: "s1", before: null });
  });

  it("appends to a collapsed section", () => {
    const folded = outlineRows(layout, new Set(["s1"]));
    // 0 Team · 1 m1:4 · 2 m1:5 · 3 Alva · 4 Ola · 5 m1:3 · 6 Not in report
    expect(clipDrop(folded, ["m1:3"], 4)).toEqual({ to: "s1", before: null });
  });

  it("never lands above the team's header", () => {
    expect(snapClipGap(0)).toBe(1);
    expect(snapClipGap(5)).toBe(5);
    expect(clipDrop(rows, ["m1:3"], 0)).toEqual({ to: TEAM_SECTION, before: "m1:4" });
  });
});

describe("dragging a player", () => {
  const rows = outlineRows(layout, new Set());
  const alva = [sectionRowKey("s1"), "m1:1", "m1:2"];
  const ola = [sectionRowKey("s2"), "m1:3"];

  it("snaps to the nearest gap between players, never into the team or the left-out group", () => {
    expect(sectionGap(rows, 1)).toBe(3);
    expect(sectionGap(rows, 5)).toBe(6);
    expect(sectionGap(rows, 7)).toBe(6);
    expect(sectionGap(rows, 9)).toBe(8);
  });

  it("turns the gap into the player's new place among the players", () => {
    expect(sectionDropIndex(rows, alva, 8)).toBe(1);
    expect(sectionDropIndex(rows, alva, 6)).toBe(0);
    expect(sectionDropIndex(rows, alva, 3)).toBe(0);
    expect(sectionDropIndex(rows, ola, 3)).toBe(0);
    expect(sectionDropIndex(rows, ola, 8)).toBe(1);
  });
});
