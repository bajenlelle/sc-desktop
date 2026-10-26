import { describe, expect, it } from "vitest";
import {
  REPORT_DRAFT_MAX_BYTES,
  REPORT_INTRO_LIMIT,
  REPORT_MAX_SECTIONS,
  REPORT_NOTE_LIMIT,
  REPORT_NOTE_STORED_MAX,
  TEAM_SECTION,
  addSections,
  clearPlacement,
  defaultOpponent,
  deriveReportLayout,
  draftBytes,
  emptyDraft,
  moveClip,
  moveSection,
  parseReportDraft,
  placementOf,
  prunePlacements,
  removeSection,
  sectionLabel,
  sectionOf,
  setIntro,
  setNote,
  setOpponent,
  setSectionPlayer,
  setStats,
  setTitle,
  type ReportDraft,
} from "../report-draft";
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
    expect(emptyDraft()).toEqual({ v: 1, title: null, opponent: null, intro: "", sections: [], placements: {} });
  });
});

describe("parseReportDraft", () => {
  it("reads back what the ops wrote", () => {
    const draft = setNote(setIntro(setTitle(two(), "AIK scouting"), "Press early."), "s1", "Drives left.");
    const withStats = setStats(moveClip(draft, "m1:3", "s1"), "s1", season);
    expect(parseReportDraft(JSON.parse(JSON.stringify(withStats)))).toEqual(withStats);
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
      placements: { "m1:1": "s1", "m1:2": 7, "m1:3": TEAM_SECTION },
    };
    const parsed = parseReportDraft(raw)!;
    expect(parsed.title).toHaveLength(120);
    expect(parsed.intro).toHaveLength(REPORT_INTRO_LIMIT);
    expect(parsed.sections[0].note).toHaveLength(REPORT_NOTE_STORED_MAX);
    expect(parsed.placements).toEqual({ "m1:1": "s1", "m1:3": TEAM_SECTION });
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

  it("prunes placements for clips that left the playlist and targets that are gone", () => {
    const draft = { ...two(), placements: { "m1:1": "s2", "m1:9": "s1", "m1:3": "zzz", "m1:2": TEAM_SECTION } };
    const items: PlaylistItem[] = [clip("m1", 1), clip("m1", 2), clip("m1", 3)];
    expect(prunePlacements(draft, items).placements).toEqual({ "m1:1": "s2", "m1:2": TEAM_SECTION });
    const clean = moveClip(two(), "m1:1", "s2");
    expect(prunePlacements(clean, items)).toBe(clean);
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
