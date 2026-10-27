import { describe, expect, it } from "vitest";
import {
  REPORT_DRAFT_MAX_BYTES,
  REPORT_INTRO_LIMIT,
  REPORT_MAX_SECTIONS,
  REPORT_NOTE_LIMIT,
  REPORT_NOTE_STORED_MAX,
  LEFT_OUT,
  TEAM_SECTION,
  addSections,
  clearPlacement,
  defaultOpponent,
  deriveReportLayout,
  draftBytes,
  emptyDraft,
  includeClips,
  moveClip,
  moveClips,
  moveSection,
  nudgeClips,
  parseReportDraft,
  placementOf,
  pruneDraft,
  recordReportEdit,
  removeSection,
  restoreStructure,
  sectionLabel,
  sectionOf,
  setIntro,
  setNote,
  setOpponent,
  setSectionPlayer,
  setStats,
  setTitle,
  structureKey,
  type ReportDraft,
} from "../report-draft";
import { emptyHistory, takeRedo, takeUndo } from "../playlist-history";
import { itemKey } from "../playlist-edits";
import type { SeasonStatsCard, StatsCardPlayer } from "../stats-card";
import type { PlayByPlayEvent, PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../../types/match";

const ALVA: StatsCardPlayer = { id: "1", name: "Alva Berg", number: "7", teamId: "10", teamName: "AIK" };
const OLA: StatsCardPlayer = { id: "2", name: "Ola Nilsson", number: "12", teamId: "10", teamName: "AIK" };
const INES: StatsCardPlayer = { id: "4", name: "Ines Ek", number: null, teamId: null, teamName: "Uppsala" };

const season: SeasonStatsCard = {
  type: "stats",
  v: 1,
  source: "genius_hosted",
  scope: "season",
  player: ALVA,
  season: { competitionId: 42132, leagueId: "superettan-herr", seasonId: "2025-26", label: "Superettan Herr 2025/26" },
  line: {
    gp: 30, gs: 30, mpg: 31.8, ppg: 13.3, rpg: 4.7, orpg: 0.5, drpg: 4.2, apg: 2.2, spg: 1.8, bpg: 0.3,
    topg: 1.1, pfpg: 3.5, fgPct: 38.7, tpm: 64, tpa: 189, tpPct: 33.9, ftPct: 90, pmPg: -8,
  },
  columns: ["pts", "reb", "stl"],
  heading: null,
  details: null,
  asOf: "2026-10-17T10:00:00Z",
};

function event(eventId: number, pid: number | null): PlayByPlayEvent {
  return {
    eventId,
    type: "3pt",
    subType: "jumpshot",
    period: 2,
    gameClockTime: "04:31:00",
    realWorldTime: "2026-10-12T17:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    player: pid === null ? undefined : { playerId: pid, pno: 7, firstName: "x", familyName: "y", teamNumber: 1 },
  } as PlayByPlayEvent;
}

function clip(matchId: string, eventId: number, over: Partial<PlaylistClipItem> = {}): PlaylistClipItem {
  return { type: "clip", matchId, eventId, ...over };
}

function text(id: string): PlaylistTextCard {
  return { type: "text", id, text: "Press early.", durationSeconds: 5 };
}

const events = new Map<string, PlayByPlayEvent>([
  ["m1:1", event(1, 1)],
  ["m1:2", event(2, 1)],
  ["m1:3", event(3, 2)],
  ["m1:4", event(4, null)],
  ["m2:1", event(1, 4)],
]);

const ids = (prefix = "s") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

/** A draft with Alva (s1) and Ola (s2). */
function two(): ReportDraft {
  return addSections(emptyDraft(), [ALVA, OLA], ids());
}

describe("an empty draft", () => {
  it("has no players, no placements and no header of its own", () => {
    expect(emptyDraft()).toEqual({ v: 1, title: null, opponent: null, intro: "", sections: [], placements: {}, order: [] });
  });
});

describe("parseReportDraft", () => {
  it("reads back what the ops wrote", () => {
    const draft = setNote(setIntro(setTitle(two(), "AIK scouting"), "Press early."), "s1", "Drives left.");
    const withStats = setStats(moveClip(draft, "m1:3", "s1"), "s1", season);
    const arranged = moveClips(withStats, deriveReportLayout(withStats, [clip("m1", 1), clip("m1", 2), clip("m1", 3), clip("m1", 4)], events), ["m1:4"], LEFT_OUT, null);
    expect(arranged.order.length).toBeGreaterThan(0);
    expect(parseReportDraft(JSON.parse(JSON.stringify(arranged)))).toEqual(arranged);
  });

  it("reads a draft stored before the report had its own order (1.4.0) as playlist order", () => {
    const { order: _o, ...old } = two();
    expect(parseReportDraft(old)?.order).toEqual([]);
  });

  it("keeps the order's strings once each, the first time they appear", () => {
    expect(parseReportDraft({ ...two(), order: ["m1:2", 7, "m1:1", "m1:2", null] })?.order).toEqual(["m1:2", "m1:1"]);
    expect(parseReportDraft({ ...two(), order: "m1:2" })?.order).toEqual([]);
  });

  it("rejects what isn't a version 1 draft", () => {
    expect(parseReportDraft(null)).toBeNull();
    expect(parseReportDraft({ ...emptyDraft(), v: 2 })).toBeNull();
    expect(parseReportDraft({ ...emptyDraft(), sections: "x" })).toBeNull();
    expect(parseReportDraft({ ...emptyDraft(), placements: [] })).toBeNull();
  });

  it("keeps the first of two sections about one player and drops a section it can't read", () => {
    const raw = {
      ...two(),
      sections: [
        { id: "s1", player: ALVA, note: "first", stats: null },
        { id: "s2", player: { ...ALVA }, note: "second", stats: null },
        { id: "s3", player: { id: 5 }, note: "", stats: null },
        { id: "s4", player: OLA, note: "", stats: { type: "stats", v: 9 } },
      ],
    };
    const parsed = parseReportDraft(raw)!;
    expect(parsed.sections.map((s) => [s.id, s.player.id, s.note, s.stats])).toEqual([
      ["s1", "1", "first", null],
      ["s4", "2", "", null],
    ]);
  });

  it("keeps string placements only and clamps the texts", () => {
    const raw = {
      ...two(),
      title: "t".repeat(500),
      intro: "i".repeat(REPORT_INTRO_LIMIT + 5),
      sections: [{ id: "s1", player: ALVA, note: "n".repeat(REPORT_NOTE_STORED_MAX + 5), stats: null }],
      placements: { "m1:1": "s1", "m1:2": 7, "m1:3": TEAM_SECTION, "m1:4": LEFT_OUT },
    };
    const parsed = parseReportDraft(raw)!;
    expect(parsed.title).toHaveLength(120);
    expect(parsed.intro).toHaveLength(REPORT_INTRO_LIMIT);
    expect(parsed.sections[0].note).toHaveLength(REPORT_NOTE_STORED_MAX);
    expect(parsed.placements).toEqual({ "m1:1": "s1", "m1:3": TEAM_SECTION, "m1:4": LEFT_OUT });
  });
});

describe("sections", () => {
  it("adds a section per player, in order, with the ids it is given", () => {
    const draft = two();
    expect(draft.sections.map((s) => [s.id, s.player.name, s.note, s.stats])).toEqual([
      ["s1", "Alva Berg", "", null],
      ["s2", "Ola Nilsson", "", null],
    ]);
    expect(sectionOf(draft, "2")?.id).toBe("s2");
    expect(sectionOf(draft, "9")).toBeUndefined();
  });

  it("skips a player who already has a section and stops at the limit", () => {
    const again = addSections(two(), [ALVA, INES], ids("t"));
    expect(again.sections.map((s) => s.id)).toEqual(["s1", "s2", "t1"]);
    const many = Array.from({ length: REPORT_MAX_SECTIONS + 3 }, (_, i) => ({ ...ALVA, id: `p${i}` }));
    expect(addSections(emptyDraft(), many, ids()).sections).toHaveLength(REPORT_MAX_SECTIONS);
  });

  it("removes a section and the placements that pointed at it", () => {
    const draft = moveClip(moveClip(two(), "m1:3", "s1"), "m1:1", TEAM_SECTION);
    const gone = removeSection(draft, "s1");
    expect(gone.sections.map((s) => s.id)).toEqual(["s2"]);
    expect(gone.placements).toEqual({ "m1:1": TEAM_SECTION });
    expect(removeSection(draft, "nope")).toBe(draft);
  });

  it("moves a section to an index, clamped to the list", () => {
    const three = addSections(two(), [INES], ids("t"));
    expect(moveSection(three, "t1", 0).sections.map((s) => s.id)).toEqual(["t1", "s1", "s2"]);
    expect(moveSection(three, "s1", 99).sections.map((s) => s.id)).toEqual(["s2", "t1", "s1"]);
    expect(moveSection(three, "s1", 0)).toBe(three);
  });

  it("changes whose section it is, unless another section has that player", () => {
    const draft = two();
    expect(setSectionPlayer(draft, "s1", INES).sections[0].player).toEqual(INES);
    expect(setSectionPlayer(draft, "s1", OLA)).toBe(draft);
    expect(setSectionPlayer(draft, "s1", ALVA)).toBe(draft);
    // The same player, as the box score names them: taken.
    const named = setSectionPlayer(draft, "s1", { ...ALVA, number: "8", teamId: "11" });
    expect(named.sections[0].player).toMatchObject({ id: "1", number: "8", teamId: "11" });
  });

  it("holds a note to the limit and keeps the stats", () => {
    const draft = setStats(setNote(two(), "s1", "x".repeat(REPORT_NOTE_LIMIT + 10)), "s1", season);
    expect(draft.sections[0].note).toHaveLength(REPORT_NOTE_LIMIT);
    expect(draft.sections[0].stats).toBe(season);
    expect(setNote(draft, "nope", "x")).toBe(draft);
  });

  it("labels a section with the shirt number when there is one", () => {
    expect(sectionLabel(ALVA)).toBe("#7 Alva Berg");
    expect(sectionLabel(INES)).toBe("Ines Ek");
  });
});

describe("header fields", () => {
  it("stores a blank title or opponent as none", () => {
    expect(setTitle(emptyDraft(), "  AIK  ").title).toBe("  AIK  ");
    expect(setTitle(emptyDraft(), "   ").title).toBeNull();
    expect(setTitle(emptyDraft(), "x".repeat(200)).title).toHaveLength(120);
    expect(setOpponent(emptyDraft(), " ").opponent).toBeNull();
    expect(setOpponent(emptyDraft(), "AIK").opponent).toBe("AIK");
  });

  it("holds the intro to its limit", () => {
    expect(setIntro(emptyDraft(), "i".repeat(REPORT_INTRO_LIMIT + 1)).intro).toHaveLength(REPORT_INTRO_LIMIT);
  });

  it("starts the opponent as the team most sections are about", () => {
    expect(defaultOpponent(addSections(emptyDraft(), [ALVA, INES, OLA], ids()))).toBe("AIK");
    expect(defaultOpponent(addSections(emptyDraft(), [INES, ALVA], ids()))).toBe("Uppsala");
    expect(defaultOpponent(addSections(emptyDraft(), [{ ...ALVA, teamName: "  " }], ids()))).toBeNull();
    expect(defaultOpponent(emptyDraft())).toBeNull();
  });
});

describe("placements", () => {
  it("a clip goes to its placement, else to its player's section, else to the team", () => {
    const draft = moveClip(two(), "m1:1", "s2");
    expect(placementOf(draft, clip("m1", 1), events.get("m1:1"))).toBe("s2"); // placed
    expect(placementOf(draft, clip("m1", 2), events.get("m1:2"))).toBe("s1"); // Alva's play
    expect(placementOf(draft, clip("m1", 4), events.get("m1:4"))).toBe(TEAM_SECTION); // no player
    expect(placementOf(draft, clip("m2", 1), events.get("m2:1"))).toBe(TEAM_SECTION); // Ines has no section
  });

  it("falls back when a placement points at a section that is gone", () => {
    const draft = { ...two(), placements: { "m1:1": "zzz" } };
    expect(placementOf(draft, clip("m1", 1), events.get("m1:1"))).toBe("s1");
  });

  it("moves a clip only to the team or a section that exists, and clears it again", () => {
    const draft = two();
    expect(moveClip(draft, "m1:1", "zzz")).toBe(draft);
    const moved = moveClip(draft, "m1:1", TEAM_SECTION);
    expect(moved.placements).toEqual({ "m1:1": TEAM_SECTION });
    expect(clearPlacement(moved, "m1:1").placements).toEqual({});
    expect(clearPlacement(draft, "m1:1")).toBe(draft);
  });

  it("prunes placements for clips that left the playlist and targets that are gone, and keeps the left-out ones", () => {
    const draft = { ...two(), placements: { "m1:1": "s2", "m1:9": "s1", "m1:3": "zzz", "m1:2": TEAM_SECTION, "m1:4": LEFT_OUT } };
    const items: PlaylistItem[] = [clip("m1", 1), clip("m1", 2), clip("m1", 3), clip("m1", 4)];
    expect(pruneDraft(draft, items).placements).toEqual({ "m1:1": "s2", "m1:2": TEAM_SECTION, "m1:4": LEFT_OUT });
    const clean = moveClip(two(), "m1:1", "s2");
    expect(pruneDraft(clean, items)).toBe(clean);
  });

  it("prunes the order of clips that left the playlist", () => {
    const draft = { ...two(), order: ["m1:3", "m1:9", "m1:1"] };
    expect(pruneDraft(draft, [clip("m1", 1), clip("m1", 3)]).order).toEqual(["m1:3", "m1:1"]);
    const clean = { ...two(), order: ["m1:3", "m1:1"] };
    expect(pruneDraft(clean, [clip("m1", 1), clip("m1", 3)])).toBe(clean);
  });

  it("places a left-out clip nowhere", () => {
    const draft = moveClip(two(), "m1:1", "s2");
    const out = { ...draft, placements: { "m1:1": LEFT_OUT } };
    expect(placementOf(out, clip("m1", 1), events.get("m1:1"))).toBe(LEFT_OUT);
  });
});

describe("deriveReportLayout", () => {
  const items: PlaylistItem[] = [clip("m1", 3), text("t1"), clip("m1", 1), clip("m1", 4), clip("m1", 2), clip("m2", 1), clip("m1", 99)];

  it("sorts the clips under their players in playlist order and the rest to the team, cards ignored", () => {
    const { sections, missing } = deriveReportLayout(two(), items, events);
    expect(sections.map((s) => [s.id, s.section?.player.name ?? null, s.clips.map((c) => `${c.matchId}:${c.eventId}`)])).toEqual([
      [TEAM_SECTION, null, ["m1:4", "m2:1"]],
      ["s1", "Alva Berg", ["m1:1", "m1:2"]],
      ["s2", "Ola Nilsson", ["m1:3"]],
    ]);
    expect(missing).toEqual([{ key: "m1:99", matchId: "m1", eventId: 99 }]);
  });

  it("lists an empty player section but leaves out an empty team section", () => {
    const { sections } = deriveReportLayout(two(), [clip("m1", 1)], events);
    expect(sections.map((s) => [s.id, s.clips.length])).toEqual([
      ["s1", 1],
      ["s2", 0],
    ]);
  });

  it("shows the team section for an intro alone", () => {
    const { sections } = deriveReportLayout(setIntro(two(), "Press early."), [clip("m1", 1)], events);
    expect(sections[0]).toMatchObject({ id: TEAM_SECTION, clips: [] });
  });

  it("honours placements, including one that sends a player's clip to the team", () => {
    const draft = moveClip(moveClip(two(), "m1:1", TEAM_SECTION), "m1:4", "s2");
    const { sections } = deriveReportLayout(draft, items, events);
    expect(sections.map((s) => [s.id, s.clips.map((c) => c.eventId)])).toEqual([
      [TEAM_SECTION, [1, 1]],
      ["s1", [2]],
      ["s2", [3, 4]],
    ]);
  });

  it("lists clips whether or not they have a hosted file", () => {
    const { sections } = deriveReportLayout(two(), [clip("m1", 1, { r2Url: "https://media.example.com/clips/m1/1_pre10.0_post3.0.mp4" }), clip("m1", 2)], events);
    expect(sections[0].clips).toHaveLength(2);
  });
});

describe("draftBytes", () => {
  it("measures the stored JSON in bytes", () => {
    expect(draftBytes(emptyDraft())).toBe(JSON.stringify(emptyDraft()).length);
    expect(draftBytes(setIntro(emptyDraft(), "åäö"))).toBe(JSON.stringify(emptyDraft()).length + 6);
    expect(REPORT_DRAFT_MAX_BYTES).toBe(256 * 1024);
  });
});

describe("the report's own order", () => {
  const items: PlaylistItem[] = [clip("m1", 3), text("t1"), clip("m1", 1), clip("m1", 4), clip("m1", 2), clip("m2", 1), clip("m1", 99)];
  const keysOf = (d: ReportDraft, opts?: { keepTeam?: boolean }) => {
    const layout = deriveReportLayout(d, items, events, opts);
    return { sections: layout.sections.map((s) => [s.id, s.clips.map(itemKey)]), leftOut: layout.leftOut.map(itemKey) };
  };

  it("sorts a section's clips by the report's order, and the clips it doesn't rank after them in playlist order", () => {
    const draft = { ...two(), order: ["m1:2", "m2:1"] };
    expect(keysOf(draft).sections).toEqual([
      [TEAM_SECTION, ["m2:1", "m1:4"]],
      ["s1", ["m1:2", "m1:1"]],
      ["s2", ["m1:3"]],
    ]);
  });

  it("lists a left-out clip apart, in playlist order, and under no section", () => {
    const draft = { ...two(), placements: { "m1:2": LEFT_OUT, "m1:4": LEFT_OUT } };
    expect(keysOf(draft)).toEqual({
      sections: [
        [TEAM_SECTION, ["m2:1"]],
        ["s1", ["m1:1"]],
        ["s2", ["m1:3"]],
      ],
      leftOut: ["m1:4", "m1:2"],
    });
  });

  it("keeps an empty team section when asked, as the editor does", () => {
    const { sections } = deriveReportLayout(two(), [clip("m1", 1)], events, { keepTeam: true });
    expect(sections.map((s) => [s.id, s.clips.length])).toEqual([
      [TEAM_SECTION, 0],
      ["s1", 1],
      ["s2", 0],
    ]);
  });
});

describe("moveClips", () => {
  const items: PlaylistItem[] = [clip("m1", 3), clip("m1", 1), clip("m1", 4), clip("m1", 2), clip("m2", 1), clip("m1", 99)];
  const lay = (d: ReportDraft) => deriveReportLayout(d, items, events, { keepTeam: true });
  const shape = (d: ReportDraft) => {
    const layout = lay(d);
    return { sections: Object.fromEntries(layout.sections.map((s) => [s.id, s.clips.map(itemKey)])), leftOut: layout.leftOut.map(itemKey) };
  };
  const move = (d: ReportDraft, keys: string[], to: string, before: string | null) => moveClips(d, lay(d), keys, to, before);

  it("reorders a section and writes down the whole reading order", () => {
    const moved = move(two(), ["m1:2"], "s1", "m1:1");
    expect(shape(moved).sections).toEqual({ [TEAM_SECTION]: ["m1:4", "m2:1"], s1: ["m1:2", "m1:1"], s2: ["m1:3"] });
    expect(moved.order).toEqual(["m1:4", "m2:1", "m1:2", "m1:1", "m1:3"]);
    expect(moved.placements).toEqual({ "m1:2": "s1" });
  });

  it("moves a clip under another player, before a clip there or to the end", () => {
    expect(shape(move(two(), ["m1:1"], "s2", "m1:3")).sections).toEqual({ [TEAM_SECTION]: ["m1:4", "m2:1"], s1: ["m1:2"], s2: ["m1:1", "m1:3"] });
    expect(shape(move(two(), ["m1:1"], "s2", null)).sections).toEqual({ [TEAM_SECTION]: ["m1:4", "m2:1"], s1: ["m1:2"], s2: ["m1:3", "m1:1"] });
  });

  it("moves several clips together, in the order they are read", () => {
    const moved = move(two(), ["m1:2", "m1:4"], "s2", null);
    expect(shape(moved).sections).toEqual({ [TEAM_SECTION]: ["m2:1"], s1: ["m1:1"], s2: ["m1:3", "m1:4", "m1:2"] });
  });

  it("moves a clip to the team when the layout it was given had no team section", () => {
    const d = two();
    const noTeam = deriveReportLayout(d, [clip("m1", 1), clip("m1", 2)], events);
    expect(noTeam.sections[0].id).toBe("s1");
    const moved = moveClips(d, noTeam, ["m1:2"], TEAM_SECTION, null);
    expect(moved.placements).toEqual({ "m1:2": TEAM_SECTION });
    expect(moved.order).toEqual(["m1:2", "m1:1"]);
  });

  it("leaves clips out of the order, and puts one back where it is dropped", () => {
    const out = move(two(), ["m1:1"], LEFT_OUT, null);
    expect(shape(out)).toEqual({ sections: { [TEAM_SECTION]: ["m1:4", "m2:1"], s1: ["m1:2"], s2: ["m1:3"] }, leftOut: ["m1:1"] });
    expect(out.order).not.toContain("m1:1");
    const back = move(out, ["m1:1"], "s2", "m1:3");
    expect(shape(back)).toEqual({ sections: { [TEAM_SECTION]: ["m1:4", "m2:1"], s1: ["m1:2"], s2: ["m1:1", "m1:3"] }, leftOut: [] });
  });

  it("changes nothing for a target that isn't one, clips it doesn't know, or a drop where the clips already are", () => {
    const d = two();
    expect(move(d, ["m1:1"], "zzz", null)).toBe(d);
    expect(move(d, ["m1:77", "m1:99"], "s2", null)).toBe(d);
    expect(move(d, ["m1:1"], "s1", "m1:2")).toBe(d);
    expect(move(d, ["m1:2"], "s1", null)).toBe(d);
  });

  it("lets a left-out clip follow its player again, at the end of the player's clips", () => {
    const ordered = move(two(), ["m1:2"], "s1", "m1:1");
    const out = move(ordered, ["m1:2"], LEFT_OUT, null);
    const back = includeClips(out, ["m1:2"]);
    expect(shape(back).sections.s1).toEqual(["m1:1", "m1:2"]);
    expect(back.placements).toEqual({});
    expect(includeClips(back, ["m1:2"])).toBe(back);
  });
});

describe("nudgeClips", () => {
  const items: PlaylistItem[] = [clip("m1", 3), clip("m1", 1), clip("m1", 4), clip("m1", 2), clip("m2", 1)];
  // Team: m1:4, m2:1 · s1 (Alva): m1:1, m1:2 · s2 (Ola): m1:3
  const layout = deriveReportLayout(two(), items, events, { keepTeam: true });

  it("moves a clip one place up or down within its section", () => {
    expect(nudgeClips(layout, ["m1:2"], -1)).toEqual({ to: "s1", before: "m1:1" });
    expect(nudgeClips(layout, ["m1:1"], 1)).toEqual({ to: "s1", before: null });
  });

  it("crosses into the section above (to its end) or below (to its start)", () => {
    expect(nudgeClips(layout, ["m1:1"], -1)).toEqual({ to: TEAM_SECTION, before: null });
    expect(nudgeClips(layout, ["m1:2"], 1)).toEqual({ to: "s2", before: "m1:3" });
  });

  it("stops at the top and the bottom of the report", () => {
    expect(nudgeClips(layout, ["m1:4"], -1)).toBeNull();
    expect(nudgeClips(layout, ["m1:3"], 1)).toBeNull();
  });

  it("moves a selection from its last clip down, and does nothing for left-out clips", () => {
    expect(nudgeClips(layout, ["m2:1", "m1:1"], 1)).toEqual({ to: "s1", before: null });
    const out = deriveReportLayout({ ...two(), placements: { "m1:1": LEFT_OUT } }, items, events, { keepTeam: true });
    expect(nudgeClips(out, ["m1:1"], -1)).toBeNull();
  });
});

describe("undoing the report's structure", () => {
  const items: PlaylistItem[] = [clip("m1", 3), clip("m1", 1), clip("m1", 4), clip("m1", 2)];
  const lay = (d: ReportDraft) => deriveReportLayout(d, items, events, { keepTeam: true });

  it("tells a change of structure from a change of words", () => {
    const d = two();
    expect(structureKey(setTitle(setNote(d, "s1", "Drives left."), "AIK"))).toBe(structureKey(d));
    expect(structureKey(moveSection(d, "s2", 0))).not.toBe(structureKey(d));
    expect(structureKey(moveClip(d, "m1:1", "s2"))).not.toBe(structureKey(d));
    expect(structureKey(moveClips(d, lay(d), ["m1:2"], "s1", "m1:1"))).not.toBe(structureKey(d));
  });

  it("brings a removed player back with their note and keeps what was typed since", () => {
    const before = setNote(two(), "s1", "Drives left.");
    const now = setTitle(setNote(removeSection(before, "s1"), "s2", "Shoots corners."), "AIK");
    const restored = restoreStructure(before, now);
    expect(restored.sections.map((s) => [s.id, s.note])).toEqual([
      ["s1", "Drives left."],
      ["s2", "Shoots corners."],
    ]);
    expect(restored.title).toBe("AIK");
  });

  it("drops players added since, and takes back the snapshot's placements and order", () => {
    const before = two();
    expect(restoreStructure(before, addSections(before, [INES], ids("t"))).sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    const moved = moveClips(before, lay(before), ["m1:1"], "s2", null);
    const restored = restoreStructure(before, moved);
    expect(restored.placements).toEqual({});
    expect(restored.order).toEqual([]);
    expect(restoreStructure(before, before)).toBe(before);
  });

  it("records an edit only when the structure changed, and steps back and forth through them", () => {
    const d = two();
    const noted = setNote(d, "s1", "x");
    expect(recordReportEdit(emptyHistory(), { label: "Note", before: d, after: noted }).past).toHaveLength(0);
    const moved = moveSection(d, "s2", 0);
    const h = recordReportEdit(emptyHistory(), { label: "Move player", before: d, after: moved });
    const undone = takeUndo(h)!;
    expect(undone.edit.before).toBe(d);
    expect(takeRedo(undone.history)!.edit.after).toBe(moved);
  });
});
