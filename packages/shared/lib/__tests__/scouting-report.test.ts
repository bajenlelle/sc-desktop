import { describe, expect, it } from "vitest";
import { buildScoutingReport, clampReportTitle, clipKeyFromUrl, reportContentKey, reportJumpItems, reportOutline, type BuildReportInput, type ReportClip } from "../scouting-report";
import type { DrawingShape } from "../clip-drawing";
import { LEFT_OUT, addSections, emptyDraft, moveClip, setIntro, setNote, setOpponent, setStats, setTitle, type ReportDraft } from "../report-draft";
import type { SeasonStatsCard, StatsCardPlayer } from "../stats-card";
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

const ALVA: StatsCardPlayer = { id: "1", name: "Alva Berg", number: "7", teamId: "10", teamName: "Bajen Basket" };
const OLA: StatsCardPlayer = { id: "2", name: "Ola Nilsson", number: "7", teamId: "10", teamName: "Bajen Basket" };

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

const events = new Map<string, PlayByPlayEvent>([
  ["m1:1", event(1, { pid: 1 })],
  ["m1:2", event(2, { pid: 1, type: "2pt", isSuccessful: 0 })],
  ["m1:3", event(3, { pid: 2, first: "Ola", family: "Nilsson" })],
  ["m1:4", event(4, { player: undefined })],
  ["m2:1", event(1, { pid: 1 })],
]);

const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};

/** Alva (s1, note + stats) and Ola (s2, note). */
function twoPlayers(): ReportDraft {
  const d = addSections(emptyDraft(), [ALVA, OLA], ids());
  return setNote(setStats(setNote(d, "s1", "Drives left."), "s1", season), "s2", "Catch and shoot.");
}

function input(draft: ReportDraft, items: PlaylistItem[], over: Partial<BuildReportInput> = {}): BuildReportInput {
  return { draft, playlist: { items }, eventByKey: events, title: "AIK scouting", now: new Date("2026-10-20T12:00:00Z"), ...over };
}

describe("buildScoutingReport", () => {
  it("makes a section per draft player, in draft order, with that player's clips in playlist order", () => {
    const { report } = buildScoutingReport(input(twoPlayers(), [clip("m1", 3), clip("m1", 1), clip("m1", 2)]));
    expect(report.sections.map((s) => [s.id, s.kind, s.player?.name, s.blocks.length])).toEqual([
      ["p1", "player", "Alva Berg", 2],
      ["p2", "player", "Ola Nilsson", 1],
    ]);
    expect(report.sections[0]).toMatchObject({ note: "Drives left.", stats: { context: expect.stringContaining("Season averages") } });
    expect(report.sections[0].blocks.map((b) => (b as { clock: string; label: string }).label)).toEqual(["3PT Made", "2PT Miss"]);
    expect(report.sections[1].stats).toBeNull();
    expect(report.header).toMatchObject({ title: "AIK scouting", players: 2, clips: 3, attribution: true });
  });

  it("puts the intro and the clips no player claims in a Team section first, and leaves it out when empty", () => {
    const withTeam = buildScoutingReport(input(setIntro(twoPlayers(), " Press them early. "), [clip("m1", 4), clip("m1", 1)])).report;
    expect(withTeam.sections.map((s) => s.id)).toEqual(["team", "p1", "p2"]);
    expect(withTeam.sections[0].blocks).toMatchObject([{ kind: "text", text: "Press them early." }, { kind: "clip" }]);

    const without = buildScoutingReport(input(twoPlayers(), [clip("m1", 1)])).report;
    expect(without.sections.map((s) => s.id)).toEqual(["p1", "p2"]);
    expect(without.sections[1].blocks).toEqual([]);
  });

  it("honours where the coach moved a clip", () => {
    const draft = moveClip(moveClip(twoPlayers(), "m1:1", "s2"), "m1:3", "team");
    const { report } = buildScoutingReport(input(draft, [clip("m1", 1), clip("m1", 2), clip("m1", 3)]));
    expect(report.sections.map((s) => [s.id, s.blocks.length])).toEqual([
      ["team", 1],
      ["p1", 1],
      ["p2", 1],
    ]);
  });

  it("reads the clips in the report's own order and leaves out the clips the coach left out", () => {
    const draft: ReportDraft = { ...twoPlayers(), order: ["m1:2", "m1:1"], placements: { "m1:4": LEFT_OUT } };
    const { report, missing } = buildScoutingReport(input(draft, [clip("m1", 1), clip("m1", 2), clip("m1", 3), clip("m1", 4)]));
    expect(report.sections.map((s) => s.id)).toEqual(["p1", "p2"]);
    expect(report.sections[0].blocks.map((b) => (b as { label: string }).label)).toEqual(["2PT Miss", "3PT Made"]);
    expect(report.header.clips).toBe(3);
    expect(missing).toEqual([]);
  });

  it("leaves the playlist's text and stats cards out: they are video cards", () => {
    const stats: PlaylistTextCard = { type: "text", id: "c1", text: "fallback line", durationSeconds: 5, card: season };
    const { report } = buildScoutingReport(input(twoPlayers(), [text("t1", "Sits on the left block."), stats, clip("m1", 1)]));
    expect(report.sections.map((s) => s.id)).toEqual(["p1", "p2"]);
    expect(report.sections[0].blocks.map((b) => b.kind)).toEqual(["clip"]);
  });

  it("reports clips with no hosted file or no play instead of dropping them silently", () => {
    const { report, missing, clipKeys } = buildScoutingReport(
      input(twoPlayers(), [clip("m1", 1), clip("m1", 2, { r2Url: undefined }), clip("m1", 99), clip("m1", 3, { r2Url: "https://elsewhere.example/not-a-clip.mp4" })]),
    );
    expect(report.sections[0].blocks).toHaveLength(1);
    expect(missing).toEqual([
      { key: "m1:99", matchId: "m1", eventId: 99, reason: "no_play" },
      { key: "m1:2", matchId: "m1", eventId: 2, reason: "not_shipped" },
      { key: "m1:3", matchId: "m1", eventId: 3, reason: "not_shipped" },
    ]);
    expect(clipKeys).toEqual(["clips/m1/1_pre10.0_post3.0_s100.0.mp4"]);
  });

  it("describes a clip the way the apps do", () => {
    const { report } = buildScoutingReport(
      input(twoPlayers(), [clip("m1", 2, { note: " Hard close-out " })], {
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
    const one = buildScoutingReport(input(twoPlayers(), [clip("m1", 1)], { matchLabel: label })).report;
    expect((one.sections[0].blocks[0] as { game: string | null }).game).toBeNull();
    const two = buildScoutingReport(input(twoPlayers(), [clip("m1", 1), clip("m2", 1)], { matchLabel: label })).report;
    expect(two.sections[0].blocks.map((b) => (b as { game: string | null }).game)).toEqual(["vs AIK", "@ Uppsala"]);
  });

  it("takes the title and opponent from the draft unless the caller says otherwise, trimmed", () => {
    const draft = setOpponent(setTitle(twoPlayers(), "Derby prep"), "  AIK  ");
    const fromDraft = buildScoutingReport({ draft, playlist: { items: [] }, eventByKey: events }).report.header;
    expect(fromDraft).toMatchObject({ title: "Derby prep", opponent: "AIK" });
    const overridden = buildScoutingReport(input(draft, [], { title: "Other", opponent: " " })).report.header;
    expect(overridden).toMatchObject({ title: "Other", opponent: null });
    expect(buildScoutingReport({ draft: emptyDraft(), playlist: { items: [] }, eventByKey: events }).report.header.title).toBe("");
  });
});

describe("content key", () => {
  const items = () => [clip("m1", 1), clip("m1", 2)];

  it("is stable across posters, time and the stats read time", () => {
    const a = buildScoutingReport(input(twoPlayers(), items())).contentKey;
    const b = buildScoutingReport(input(twoPlayers(), items(), { now: new Date("2027-01-01T00:00:00Z"), posters: new Map([["m1:1", "highlights/x/y.jpg"]]) })).contentKey;
    expect(b).toBe(a);
    const later = setStats(twoPlayers(), "s1", { ...season, asOf: "2026-12-01T00:00:00Z" });
    expect(buildScoutingReport(input(later, items())).contentKey).toBe(a);
  });

  it("is the same whether a clip sits under its player by itself or by an explicit placement", () => {
    const a = buildScoutingReport(input(twoPlayers(), items())).contentKey;
    expect(buildScoutingReport(input(moveClip(twoPlayers(), "m1:1", "s1"), items())).contentKey).toBe(a);
  });

  it("moves when what the report says moves", () => {
    const base = buildScoutingReport(input(twoPlayers(), items())).contentKey;
    const note = buildScoutingReport(input(setNote(twoPlayers(), "s1", "Drives right."), items())).contentKey;
    const order = buildScoutingReport(input(twoPlayers(), [clip("m1", 2), clip("m1", 1)])).contentKey;
    const noClip = buildScoutingReport(input(twoPlayers(), [clip("m1", 1)])).contentKey;
    const unshipped = buildScoutingReport(input(twoPlayers(), [clip("m1", 1), clip("m1", 2, { r2Url: undefined })])).contentKey;
    const moved = buildScoutingReport(input(moveClip(twoPlayers(), "m1:1", "s2"), items())).contentKey;
    const reordered = buildScoutingReport(input({ ...twoPlayers(), order: ["m1:2", "m1:1"] }, items())).contentKey;
    const leftOut = buildScoutingReport(input({ ...twoPlayers(), placements: { "m1:2": LEFT_OUT } }, items())).contentKey;
    expect(new Set([base, note, order, noClip, moved]).size).toBe(5);
    // The report's own order reads like a playlist in that order; a clip left out like one that isn't there.
    expect(reordered).toBe(order);
    expect(leftOut).toBe(noClip);
    // A clip that lost its hosted file reads like a dropped one: the page can't play it either way.
    expect(unshipped).toBe(noClip);
  });

  it("ignores the share sheet's own fields: the title, the opponent and the footer mark", () => {
    const base = buildScoutingReport(input(twoPlayers(), items())).contentKey;
    expect(buildScoutingReport(input(twoPlayers(), items(), { title: "Other" })).contentKey).toBe(base);
    expect(buildScoutingReport(input(twoPlayers(), items(), { opponent: "AIK" })).contentKey).toBe(base);
    expect(buildScoutingReport(input(twoPlayers(), items(), { attribution: false })).contentKey).toBe(base);
  });

  it("is a function of the report alone", () => {
    const { report, contentKey } = buildScoutingReport(input(twoPlayers(), items()));
    expect(reportContentKey(report)).toBe(contentKey);
  });

  it("is what it was before clips had drawings and slow motion, for a report without them", () => {
    // Pinned with the code from before effects: a shared report without them stays up to date.
    expect(buildScoutingReport(input(twoPlayers(), items())).contentKey).toMatchInlineSnapshot(`"23sxqjiv4lq"`);
  });
});

describe("drawings and slow motion", () => {
  // The fixture's files start 100 s into the game's video (url(): _s100.0).
  const drawn = (over: Partial<PlaylistClipItem> = {}) =>
    clip("m1", 1, {
      drawings: [
        {
          id: "8c1f2b9e-drawing",
          t: 102.5,
          hold: 4,
          shapes: [
            { kind: "spotlight", id: "8c1f2b9e-spot", at: { x: 0.51234, y: 0.4 }, r: 0.08512 },
            { kind: "arrow", id: "8c1f2b9e-arrow", arrow: "pass", from: { x: 0.1, y: 0.2 }, to: { x: 0.3, y: 0.40049 }, bend: 0.33333, color: "red" },
          ],
        },
      ],
      slowMotion: [{ id: "8c1f2b9e-slow", t: 101, length: 2, rate: 0.5 }],
      ...over,
    });
  const clipOf = (items: PlaylistItem[]) =>
    buildScoutingReport(input(twoPlayers(), items)).report.sections.flatMap((s) => s.blocks).find((b) => b.kind === "clip") as ReportClip;

  it("carries a clip's drawings and slow motion in its file's time, with short ids and points at three decimals", () => {
    const c = clipOf([drawn()]);
    expect(c.drawings).toEqual([
      {
        id: "d1",
        at: 2.5,
        hold: 4,
        shapes: [
          { kind: "spotlight", id: "s1", at: { x: 0.512, y: 0.4 }, r: 0.085 },
          { kind: "arrow", id: "s2", arrow: "pass", from: { x: 0.1, y: 0.2 }, to: { x: 0.3, y: 0.4 }, bend: 0.333, color: "red" },
        ],
      },
    ]);
    expect(c.slowMotion).toEqual([{ id: "w1", at: 1, length: 2, rate: 0.5 }]);
  });

  it("leaves both out for a clip without them, or whose file doesn't say where it starts", () => {
    const plain = clipOf([clip("m1", 1)]);
    expect("drawings" in plain || "slowMotion" in plain).toBe(false);
    const legacy = clipOf([drawn({ r2Url: `${HOST}/clips/m1/1_pre10.0_post3.0.mp4` })]);
    expect("drawings" in legacy || "slowMotion" in legacy).toBe(false);
  });

  it("moves the content key when a drawing or a section changes", () => {
    const keyOf = (item: PlaylistClipItem) => buildScoutingReport(input(twoPlayers(), [item, clip("m1", 2)])).contentKey;
    const d = drawn().drawings![0];
    const plain = keyOf(clip("m1", 1));
    const base = keyOf(drawn());
    const moved = keyOf(drawn({ drawings: [{ ...d, shapes: [{ ...d.shapes[0], at: { x: 0.6, y: 0.4 } } as DrawingShape, d.shapes[1]] }] }));
    const held = keyOf(drawn({ drawings: [{ ...d, hold: 6 }] }));
    const quarter = keyOf(drawn({ slowMotion: [{ id: "w", t: 101, length: 2, rate: 0.25 }] }));
    const longer = keyOf(drawn({ slowMotion: [{ id: "w", t: 101, length: 3, rate: 0.5 }] }));
    expect(new Set([plain, base, moved, held, quarter, longer]).size).toBe(6);
  });

  it("keeps the content key when the same effects come back from the database with other ids and key order", () => {
    const keyOf = (item: PlaylistClipItem) => buildScoutingReport(input(twoPlayers(), [item])).contentKey;
    const reloaded = drawn({
      drawings: JSON.parse(
        '[{"t":102.5,"id":"other","hold":4,"shapes":[{"r":0.08512,"at":{"y":0.4,"x":0.51234},"id":"a","kind":"spotlight"},{"to":{"y":0.40049,"x":0.3},"bend":0.33333,"from":{"y":0.2,"x":0.1},"color":"red","arrow":"pass","id":"b","kind":"arrow"}]}]',
      ),
      slowMotion: JSON.parse('[{"t":101,"rate":0.5,"id":"z","length":2}]'),
    });
    expect(keyOf(reloaded)).toBe(keyOf(drawn()));
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

describe("clampReportTitle", () => {
  it("holds a title to what the database accepts", () => {
    expect(clampReportTitle("  AIK  ")).toBe("AIK");
    expect(clampReportTitle("x".repeat(500))).toHaveLength(120);
  });
});

describe("reportOutline", () => {
  it("counts a section's clips whether or not their files are hosted yet", () => {
    const rows = reportOutline(twoPlayers(), [clip("m1", 1), clip("m1", 2, { r2Url: undefined }), clip("m1", 3, { r2Url: undefined })], events);
    expect(rows).toEqual([
      { id: "p1", label: "#7 Alva Berg", clips: 2, note: true, stats: true },
      { id: "p2", label: "#7 Ola Nilsson", clips: 1, note: true, stats: false },
    ]);
  });

  it("leaves out a play the game data no longer has, and shows Team only when it has clips or an intro", () => {
    expect(reportOutline(twoPlayers(), [clip("m1", 99)], events).map((r) => [r.id, r.clips])).toEqual([
      ["p1", 0],
      ["p2", 0],
    ]);
    const withTeam = reportOutline(twoPlayers(), [clip("m1", 4)], events);
    expect(withTeam.map((r) => [r.id, r.label, r.clips])).toEqual([
      ["team", "Team", 1],
      ["p1", "#7 Alva Berg", 0],
      ["p2", "#7 Ola Nilsson", 0],
    ]);
    expect(reportOutline(setIntro(twoPlayers(), "Intro"), [], events)[0]).toMatchObject({ id: "team", clips: 0, note: true });
  });

  it("matches the built report's sections for a fully hosted playlist", () => {
    const draft = setIntro(twoPlayers(), "Intro");
    const items = [clip("m1", 4), clip("m1", 1), clip("m1", 2), clip("m1", 3)];
    const outline = reportOutline(draft, items, events);
    const built = buildScoutingReport(input(draft, items)).report.sections;
    expect(outline.map((r) => [r.id, r.clips])).toEqual(built.map((s) => [s.id, s.blocks.filter((b) => b.kind === "clip").length]));
  });
});

describe("reportJumpItems", () => {
  const ALVA_P: { id: string; name: string; number: string | null; teamName: string } = { id: "1", name: "Alva Berg", number: "7", teamName: "AIK" };
  const section = (id: string, player: typeof ALVA_P | null) => ({ id, kind: player ? ("player" as const) : ("team" as const), player, note: "", stats: null, blocks: [] });

  it("puts a chip per section in page order, the team's first, a player by number and last name", () => {
    expect(
      reportJumpItems([section("team", null), section("p1", ALVA_P), section("p2", { ...ALVA_P, id: "2", name: "Ola van Nilsson", number: null })]),
    ).toEqual([
      { id: "team", label: "Team" },
      { id: "p1", label: "#7 Berg" },
      { id: "p2", label: "Nilsson" },
    ]);
  });

  it("is empty for a report with no sections", () => {
    expect(reportJumpItems([])).toEqual([]);
  });
});
