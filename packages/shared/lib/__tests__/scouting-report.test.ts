import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  clampReportTitle,
  clipKeyFromUrl,
  defaultOpponent,
  playerCardTarget,
  playerSectionInfo,
  reportContentKey,
  reportOutline,
  sectionBlockKeys,
  sectionEnd,
  snapGapToSectionBoundary,
  type BuildReportInput,
} from "../scouting-report";
import { newPlayerCard } from "../player-card";
import type { SeasonStatsCard } from "../stats-card";
import type { PlayByPlayEvent, PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../../types/match";

const HOST = "https://media.example.com";

function url(matchId: string, eventId: number): string {
  return `${HOST}/clips/${matchId}/${eventId}_pre10.0_post3.0_s100.0.mp4`;
}

function event(eventId: number, over: Partial<PlayByPlayEvent> & { pid?: number; first?: string; family?: string } = {}): PlayByPlayEvent {
  const { pid = 1, first = "Alva", family = "Berg", ...rest } = over;
  return {
    eventId,
    type: "3pt",
    subType: "jumpshot",
    period: 2,
    gameClockTime: "04:31:00",
    realWorldTime: "2026-10-12T17:00:00Z",
    isSuccessful: 1,
    qualifiers: [],
    player: { playerId: pid, pno: 7, firstName: first, familyName: family, teamNumber: 1 },
    eventTeam: { teamCode: "BB", teamName: "Bajen Basket", teamNumber: 1 },
    ...rest,
  };
}

function clip(matchId: string, eventId: number, over: Partial<PlaylistClipItem> = {}): PlaylistClipItem {
  return { type: "clip", matchId, eventId, r2Url: url(matchId, eventId), ...over };
}

function text(id: string, body: string): PlaylistTextCard {
  return { type: "text", id, text: body, durationSeconds: 5 };
}

const season: SeasonStatsCard = {
  type: "stats",
  v: 1,
  source: "genius_hosted",
  scope: "season",
  player: { id: "1", name: "Alva Berg", number: "7", teamId: "10", teamName: "Bajen Basket" },
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

function playerItem(id: string, playerId: string, name: string, note = "", stats: SeasonStatsCard | null = null): PlaylistTextCard {
  const spec = {
    ...newPlayerCard({ id: playerId, name, number: "7", teamId: "10", teamName: "Bajen Basket" }, stats),
    note,
  };
  return { type: "text", id, text: name, durationSeconds: 0, player: spec };
}

const events = new Map<string, PlayByPlayEvent>([
  ["m1:1", event(1, { pid: 1 })],
  ["m1:2", event(2, { pid: 1, type: "2pt", isSuccessful: 0 })],
  ["m1:3", event(3, { pid: 2, first: "Ola", family: "Nilsson" })],
  ["m2:1", event(1, { pid: 1 })],
]);

function input(items: PlaylistItem[], over: Partial<BuildReportInput> = {}): BuildReportInput {
  return { playlist: { items }, eventByKey: events, title: "AIK scouting", now: new Date("2026-10-20T12:00:00Z"), ...over };
}

describe("buildScoutingReport", () => {
  it("walks the playlist into a section per player, in order", () => {
    const { report } = buildScoutingReport(
      input([
        playerItem("p1", "1", "Alva Berg", "Drives left.", season),
        clip("m1", 1),
        clip("m1", 2),
        playerItem("p2", "2", "Ola Nilsson", "Catch and shoot."),
        clip("m1", 3),
      ]),
    );
    expect(report.sections.map((s) => [s.id, s.kind, s.player?.name, s.blocks.length])).toEqual([
      ["p1", "player", "Alva Berg", 2],
      ["p2", "player", "Ola Nilsson", 1],
    ]);
    expect(report.sections[0]).toMatchObject({ note: "Drives left.", stats: { context: expect.stringContaining("Season averages") } });
    expect(report.sections[1].stats).toBeNull();
    expect(report.header).toMatchObject({ title: "AIK scouting", players: 2, clips: 3, attribution: true });
  });

  it("puts what comes before the first player card in a Team section, and leaves it out when empty", () => {
    const withTeam = buildScoutingReport(
      input([text("t1", "Press them early."), clip("m1", 3), playerItem("p1", "1", "Alva Berg"), clip("m1", 1)]),
    ).report;
    expect(withTeam.sections.map((s) => s.id)).toEqual(["team", "p1"]);
    expect(withTeam.sections[0].blocks).toMatchObject([{ kind: "text", text: "Press them early." }, { kind: "clip" }]);

    const without = buildScoutingReport(input([playerItem("p1", "1", "Alva Berg"), clip("m1", 1)])).report;
    expect(without.sections.map((s) => s.id)).toEqual(["p1"]);
  });

  it("turns text cards into paragraphs where they sit and stats cards into stats rows", () => {
    const stats: PlaylistTextCard = { type: "text", id: "s1", text: "fallback line", durationSeconds: 5, card: season };
    const { report } = buildScoutingReport(
      input([playerItem("p1", "1", "Alva Berg"), text("t1", "  Sits on the left block.  "), stats, text("t2", "   ")]),
    );
    const blocks = report.sections[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ kind: "text", text: "Sits on the left block." });
    expect(blocks[1]).toMatchObject({ kind: "stats", heading: "Alva Berg", stats: { cells: expect.any(Array) } });
  });

  it("reports clips with no hosted file or no play instead of dropping them silently", () => {
    const { report, missing, clipKeys } = buildScoutingReport(
      input([
        playerItem("p1", "1", "Alva Berg"),
        clip("m1", 1),
        clip("m1", 2, { r2Url: undefined }),
        clip("m1", 99),
        clip("m1", 3, { r2Url: "https://elsewhere.example/not-a-clip.mp4" }),
      ]),
    );
    expect(report.sections[0].blocks).toHaveLength(1);
    expect(missing).toEqual([
      { key: "m1:2", matchId: "m1", eventId: 2, reason: "not_shipped" },
      { key: "m1:99", matchId: "m1", eventId: 99, reason: "no_play" },
      { key: "m1:3", matchId: "m1", eventId: 3, reason: "not_shipped" },
    ]);
    expect(clipKeys).toEqual(["clips/m1/1_pre10.0_post3.0_s100.0.mp4"]);
  });

  it("describes a clip the way the apps do", () => {
    const { report } = buildScoutingReport(
      input([playerItem("p1", "1", "Alva Berg"), clip("m1", 2, { note: " Hard close-out " })], {
        labelsByKey: new Map([["m1:2", ["Pick & Roll", "Iso", "Third"]]]),
        posters: new Map([["m1:2", "highlights/0a1b2c3d-0000-4000-8000-000000000001/0a1b2c3d-0000-4000-8000-000000000002.jpg"]]),
      }),
    );
    expect(report.sections[0].blocks[0]).toMatchObject({
      kind: "clip",
      id: "c1",
      label: "2PT Miss",
      type: "2pt",
      made: false,
      period: "Q2",
      clock: "04:31",
      game: null,
      note: "Hard close-out",
      labels: ["Pick & Roll", "Iso"],
      posterKey: expect.stringMatching(/^highlights\//),
    });
  });

  it("names a clip's game only when the clips come from more than one", () => {
    const label = (id: string) => (id === "m1" ? "vs AIK" : "@ Uppsala");
    const one = buildScoutingReport(input([playerItem("p1", "1", "Alva Berg"), clip("m1", 1)], { matchLabel: label })).report;
    expect((one.sections[0].blocks[0] as { game: string | null }).game).toBeNull();
    const two = buildScoutingReport(input([playerItem("p1", "1", "Alva Berg"), clip("m1", 1), clip("m2", 1)], { matchLabel: label })).report;
    expect(two.sections[0].blocks.map((b) => (b as { game: string | null }).game)).toEqual(["vs AIK", "@ Uppsala"]);
  });

  it("trims the opponent and drops an empty one", () => {
    expect(buildScoutingReport(input([], { opponent: "  AIK  " })).report.header.opponent).toBe("AIK");
    expect(buildScoutingReport(input([], { opponent: " " })).report.header.opponent).toBeNull();
  });
});

describe("content key", () => {
  const items = () => [playerItem("p1", "1", "Alva Berg", "Drives left.", season), clip("m1", 1), clip("m1", 2)];

  it("is stable across posters, time and the stats read time", () => {
    const a = buildScoutingReport(input(items())).contentKey;
    const b = buildScoutingReport(
      input(items(), { now: new Date("2027-01-01T00:00:00Z"), posters: new Map([["m1:1", "highlights/x/y.jpg"]]) }),
    ).contentKey;
    expect(b).toBe(a);
    const later = playerItem("p1", "1", "Alva Berg", "Drives left.", { ...season, asOf: "2026-12-01T00:00:00Z" });
    expect(buildScoutingReport(input([later, clip("m1", 1), clip("m1", 2)])).contentKey).toBe(a);
  });

  it("moves when what the playlist says moves", () => {
    const base = buildScoutingReport(input(items())).contentKey;
    const note = buildScoutingReport(input([playerItem("p1", "1", "Alva Berg", "Drives right.", season), clip("m1", 1), clip("m1", 2)])).contentKey;
    const order = buildScoutingReport(input([playerItem("p1", "1", "Alva Berg", "Drives left.", season), clip("m1", 2), clip("m1", 1)])).contentKey;
    const noClip = buildScoutingReport(input([playerItem("p1", "1", "Alva Berg", "Drives left.", season), clip("m1", 1)])).contentKey;
    expect(new Set([base, note, order, noClip]).size).toBe(4);
  });

  it("ignores the share sheet's own fields: the title, the opponent and the footer mark", () => {
    const base = buildScoutingReport(input(items())).contentKey;
    expect(buildScoutingReport(input(items(), { title: "Other" })).contentKey).toBe(base);
    expect(buildScoutingReport(input(items(), { opponent: "AIK" })).contentKey).toBe(base);
    expect(buildScoutingReport(input(items(), { attribution: false })).contentKey).toBe(base);
  });

  it("is a function of the report alone", () => {
    const { report, contentKey } = buildScoutingReport(input(items()));
    expect(reportContentKey(report)).toBe(contentKey);
  });
});

describe("clipKeyFromUrl", () => {
  it("takes the storage key off a public clip URL", () => {
    expect(clipKeyFromUrl(url("m1", 5))).toBe("clips/m1/5_pre10.0_post3.0_s100.0.mp4");
    expect(clipKeyFromUrl(`${HOST}/media/clips/m1/5_pre-2.0_post3.0.mp4`)).toBe("clips/m1/5_pre-2.0_post3.0.mp4");
  });

  it("refuses anything that isn't a shipped clip", () => {
    expect(clipKeyFromUrl("not a url")).toBeNull();
    expect(clipKeyFromUrl(`${HOST}/highlights/a/b.mp4`)).toBeNull();
    expect(clipKeyFromUrl(`${HOST}/clips/m1/../x.mp4`)).toBeNull();
    expect(clipKeyFromUrl(`${HOST}/clips/m1/5_pre10.0_post3.0.mp4.exe`)).toBeNull();
  });
});

describe("playerCardTarget", () => {
  it("takes the player of the clips just below the insertion", () => {
    const items: PlaylistItem[] = [clip("m1", 3), clip("m1", 1), clip("m1", 2)];
    expect(playerCardTarget(items, 1, events)).toMatchObject({ playerId: "1", matchId: "m1", defaultScope: "season" });
  });

  it("stops at the next player card and then looks above", () => {
    const items: PlaylistItem[] = [clip("m1", 3), playerItem("p2", "2", "Ola Nilsson"), clip("m1", 1)];
    // Below index 1 is Ola's card at once, so the clip above (Ola's too) is taken: Ola already has a card.
    expect(playerCardTarget(items, 1, events)).toBeNull();
    // Inserted at 2, the clip below is Alva's.
    expect(playerCardTarget(items, 2, events)).toMatchObject({ playerId: "1" });
  });

  it("never defaults to a player who already has a card", () => {
    const items: PlaylistItem[] = [playerItem("p1", "1", "Alva Berg"), clip("m1", 1), clip("m1", 3)];
    expect(playerCardTarget(items, 3, events)).toMatchObject({ playerId: "2" });
  });

  it("starts from the clip a row's menu names", () => {
    const items: PlaylistItem[] = [clip("m1", 1), clip("m1", 3)];
    const target = playerCardTarget(items, 1, events, { anchor: { matchId: "m1", event: events.get("m1:3")! } });
    expect(target).toMatchObject({ playerId: "2", matchId: "m1" });
  });

  it("is null when no clip near the insertion has a player", () => {
    const noPlayer = new Map<string, PlayByPlayEvent>([["m1:1", { ...event(1), player: null }]]);
    expect(playerCardTarget([clip("m1", 1)], 0, noPlayer)).toBeNull();
    expect(playerCardTarget([], 0, events)).toBeNull();
  });
});

describe("a player card's section", () => {
  const items: PlaylistItem[] = [
    clip("m1", 3),
    playerItem("p1", "1", "Alva Berg"),
    clip("m1", 1),
    text("t1", "note"),
    playerItem("p2", "2", "Ola Nilsson"),
    clip("m1", 2),
    clip("m2", 1, { groupId: "g" }),
  ];

  it("ends at the next player card", () => {
    expect(sectionEnd(items, 1)).toBe(4);
    expect(sectionEnd(items, 4)).toBe(items.length);
  });

  it("counts the clips below and finds the same player's clips elsewhere", () => {
    // Alva (id 1): m1:1 is below her card; m1:2 sits under Ola's card; m2:1 is grouped, so the helper leaves it.
    expect(playerSectionInfo(items, 1, events)).toEqual({ clips: 1, elsewhere: ["m1:2"] });
    expect(playerSectionInfo(items, 4, events)).toEqual({ clips: 2, elsewhere: ["m1:3"] });
  });

  it("says nothing for a row that isn't a player card", () => {
    expect(playerSectionInfo(items, 0, events)).toEqual({ clips: 0, elsewhere: [] });
  });
});

describe("share sheet defaults", () => {
  const card = (id: string, team: string) => {
    const c = playerItem(id, id, `Player ${id}`);
    return { ...c, player: { ...c.player!, player: { ...c.player!.player, teamName: team } } };
  };

  it("starts the opponent as the team the player cards are about", () => {
    expect(defaultOpponent([card("a", "AIK"), card("b", "Uppsala"), card("c", "AIK")])).toBe("AIK");
  });

  it("keeps the first team on a tie, ignores blanks and clips, and is null with no team", () => {
    expect(defaultOpponent([card("a", "AIK"), card("b", "Uppsala")])).toBe("AIK");
    expect(defaultOpponent([card("a", "  "), clip("m1", 1)])).toBeNull();
    expect(defaultOpponent([])).toBeNull();
  });

  it("holds a title to what the database accepts", () => {
    expect(clampReportTitle("  AIK  ")).toBe("AIK");
    expect(clampReportTitle("x".repeat(500))).toHaveLength(120);
  });
});

describe("dragging a section", () => {
  // t0 | P1 a b | P2 c | P3 d e   (indices 0..8)
  const rows = ["t0", "P1", "a", "b", "P2", "c", "P3", "d", "e"];
  const keyOf = (r: string) => r;
  const isHead = (r: string) => r.startsWith("P");

  it("takes the head and its rows up to the next head", () => {
    expect(sectionBlockKeys(rows, keyOf, isHead, "P1")).toEqual(["P1", "a", "b"]);
    expect(sectionBlockKeys(rows, keyOf, isHead, "P3")).toEqual(["P3", "d", "e"]);
  });

  it("is null for a row that isn't a head, or isn't there", () => {
    expect(sectionBlockKeys(rows, keyOf, isHead, "a")).toBeNull();
    expect(sectionBlockKeys(rows, keyOf, isHead, "zzz")).toBeNull();
  });

  it("snaps a drop mid-section to the nearest section boundary", () => {
    const block = new Set(["P1", "a", "b"]);
    // gap 6 is a boundary (before P3); gap 5 is inside P2's section, one from 4 and one from 6: the earlier wins.
    expect(snapGapToSectionBoundary(6, rows, keyOf, isHead, block)).toBe(6);
    expect(snapGapToSectionBoundary(5, rows, keyOf, isHead, block)).toBe(4);
    expect(snapGapToSectionBoundary(8, rows, keyOf, isHead, block)).toBe(9);
    expect(snapGapToSectionBoundary(9, rows, keyOf, isHead, block)).toBe(9);
  });

  it("never lands inside the team rows above the first section", () => {
    const block = new Set(["P3", "d", "e"]);
    // Gap 0 sits before the team row t0; the nearest boundary is the first head (index 1).
    expect(snapGapToSectionBoundary(0, rows, keyOf, isHead, block)).toBe(1);
  });

  it("leaves a gap inside the dragged block alone", () => {
    const block = new Set(["P1", "a", "b"]);
    expect(snapGapToSectionBoundary(3, rows, keyOf, isHead, block)).toBe(3);
  });
});

describe("reportOutline", () => {
  it("counts a section's clips whether or not their files are hosted yet", () => {
    const rows = reportOutline(
      [
        playerItem("p1", "1", "Alva Berg", "Drives left.", season),
        clip("m1", 1),
        clip("m1", 2, { r2Url: undefined }),
        playerItem("p2", "2", "Ola Nilsson"),
        clip("m1", 3, { r2Url: undefined }),
      ],
      events,
    );
    expect(rows).toEqual([
      { id: "p1", label: "#7 Alva Berg", clips: 2, note: true, stats: true },
      { id: "p2", label: "#7 Ola Nilsson", clips: 1, note: false, stats: false },
    ]);
  });

  it("leaves out a play the game data no longer has, and shows Team only when something sits above the first card", () => {
    expect(reportOutline([clip("m1", 99), playerItem("p1", "1", "Alva Berg")], events)).toEqual([
      { id: "p1", label: "#7 Alva Berg", clips: 0, note: false, stats: false },
    ]);
    const withTeam = reportOutline([text("t1", "Press early."), clip("m1", 3), playerItem("p1", "1", "Alva Berg")], events);
    expect(withTeam.map((r) => [r.id, r.label, r.clips])).toEqual([["team", "Team", 1], ["p1", "#7 Alva Berg", 0]]);
  });

  it("matches the built report's sections for a fully hosted playlist", () => {
    const items = [text("t1", "Intro"), clip("m1", 3), playerItem("p1", "1", "Alva Berg", "n"), clip("m1", 1), clip("m1", 2)];
    const outline = reportOutline(items, events);
    const built = buildScoutingReport(input(items)).report.sections;
    expect(outline.map((r) => [r.id, r.clips])).toEqual(built.map((s) => [s.id, s.blocks.filter((b) => b.kind === "clip").length]));
  });
});
