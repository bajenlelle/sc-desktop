import { describe, expect, it } from "vitest";
import { parseReportDraft } from "../report-draft";
import type { ReportDraftRow } from "../scouting-report-list";
import type { StatsCardSpec } from "../stats-card";
import type { SeasonLine } from "../stat-lines";
import type { TeamKey, TeamKeys } from "../team-keys";
import type { TeamPlayerRow, WhoDoesWhat } from "../team-players";
import { buildTeamReportDraft, findTeamReport, pickReportPlayers, reportPlayerOf, teamReportIntro, teamReportName } from "../team-report";

const line = (over: Partial<SeasonLine> = {}): SeasonLine => ({
  gp: 10,
  gs: null,
  mpg: 20,
  ppg: 8,
  rpg: null,
  orpg: 1,
  drpg: null,
  apg: null,
  spg: null,
  bpg: null,
  topg: null,
  pfpg: null,
  fgPct: null,
  tpm: null,
  tpa: 30,
  tpPct: null,
  ftPct: 70,
  ftaPg: 3,
  pmPg: null,
  ...over,
});

const row = (personId: string, name: string, mpg: number): TeamPlayerRow => ({ personId, name, number: personId, line: line({ mpg }), stints: 1 });
const named = (personId: string) => ({ personId, name: personId, value: 1 });
const who = (over: Partial<WhoDoesWhat> = {}): WhoDoesWhat => ({ threes: [], offensiveGlass: [], toTheLine: [], freeThrows: null, ...over });

// Most minutes first, as teamPlayers orders them.
const rows = [row("1", "Lind", 32), row("2", "Berg", 30), row("3", "Ali", 28), row("4", "Nyström", 20), row("5", "Ek", 12)];

describe("teamReportName", () => {
  it("names the team and the game's day", () => {
    expect(teamReportName("AIK", { id: "9", at: "2026-11-28T15:00:00Z", home: false })).toBe("AIK · Sat 28 Nov");
  });

  it("is the team alone without a game", () => {
    expect(teamReportName("AIK", null)).toBe("AIK");
  });

  it("never names a report with nothing", () => {
    expect(teamReportName("  ", null)).toBe("Opponent");
  });
});

describe("pickReportPlayers", () => {
  it("starts with the shooter, the offensive rebounder and the player at the line", () => {
    const picked = pickReportPlayers(rows, who({ threes: [named("4")], offensiveGlass: [named("5")], toTheLine: [named("2")] }));
    expect(picked.map((r) => r.personId)).toEqual(["4", "5", "2"]);
  });

  it("names a player once and tops up with the most minutes", () => {
    const picked = pickReportPlayers(rows, who({ threes: [named("3")], offensiveGlass: [named("3")], toTheLine: [named("3")] }));
    expect(picked.map((r) => r.personId)).toEqual(["3", "1", "2"]);
  });

  it("skips a leader who isn't on the roster", () => {
    expect(pickReportPlayers(rows, who({ threes: [named("99")] })).map((r) => r.personId)).toEqual(["1", "2", "3"]);
  });

  it("takes what there is from a short roster", () => {
    expect(pickReportPlayers(rows.slice(0, 2), who()).map((r) => r.personId)).toEqual(["1", "2"]);
    expect(pickReportPlayers([], who())).toEqual([]);
  });
});

const key = (end: TeamKey["end"], metric: TeamKey["metric"], high: boolean, value: number, place: number, score: number): TeamKey => ({
  end,
  metric,
  high,
  value,
  place,
  of: 12,
  score,
});

describe("teamReportIntro", () => {
  it("is empty while it's too early to say", () => {
    expect(teamReportIntro({ status: "early", games: 3, withBall: [], withoutBall: [] }, null)).toBe("");
    expect(teamReportIntro(null, null)).toBe("");
  });

  it("is empty when nothing stands out", () => {
    expect(teamReportIntro({ status: "ready", games: 9, withBall: [], withoutBall: [] }, null)).toBe("");
  });

  it("writes the three surest keys from both ends", () => {
    const keys: TeamKeys = {
      status: "ready",
      games: 12,
      withBall: [key("own", "threeRate", true, 0.44, 1, 2.5), key("own", "pace", true, 78, 1, 4)],
      withoutBall: [key("allowed", "orebPct", false, 0.22, 2, 3), key("allowed", "ppp", false, 0.94, 1, 2.1)],
    };
    expect(teamReportIntro(keys, "Norra")).toBe(
      [
        "What stands out:",
        "• Play fast: 78 possessions a game, most in Norra.",
        "• Clean the defensive glass: opponents win 22% of their misses, 2nd of 12.",
        "• Shoot a lot of threes: 44% of shots, most in Norra.",
      ].join("\n"),
    );
  });
});

const team = { competitionId: 41001, teamId: 7, name: "AIK" };
const game = { id: "2903959", at: "2026-11-28T15:00:00Z", home: false };
const card = { kind: "season" } as unknown as StatsCardSpec;

describe("buildTeamReportDraft", () => {
  it("knows the opponent, the game, the intro and starts with the players and their cards", () => {
    let n = 0;
    const draft = buildTeamReportDraft(
      {
        team,
        game,
        intro: "What stands out:\n• Play fast.",
        players: [
          { player: reportPlayerOf(rows[0], "AIK"), stats: card },
          { player: reportPlayerOf(rows[1], "AIK"), stats: null },
        ],
      },
      () => `s${++n}`,
    );
    expect(draft.opponent).toBe("AIK");
    expect(draft.title).toBeNull();
    expect(draft.team).toEqual(team);
    expect(draft.game).toEqual(game);
    expect(draft.intro).toBe("What stands out:\n• Play fast.");
    expect(draft.sections.map((s) => [s.id, s.player.name, s.player.teamName, s.stats])).toEqual([
      ["s1", "Lind", "AIK", card],
      ["s2", "Berg", "AIK", null],
    ]);
  });
});

describe("the draft's team and game", () => {
  const base = { v: 1, title: null, opponent: "AIK", intro: "", sections: [], placements: {}, order: [] };

  it("survive a save and a read", () => {
    const draft = parseReportDraft({ ...base, team, game });
    expect(draft?.team).toEqual(team);
    expect(draft?.game).toEqual(game);
  });

  it("are null in a draft from before them, or when they can't be read", () => {
    expect(parseReportDraft(base)).toMatchObject({ team: null, game: null });
    expect(parseReportDraft({ ...base, team: { competitionId: "41001", teamId: 7, name: "AIK" }, game: { id: "9", at: "soon", home: false } })).toMatchObject({
      team: null,
      game: null,
    });
  });
});

describe("findTeamReport", () => {
  const draftRow = (playlistId: string, over: Partial<ReportDraftRow> = {}): ReportDraftRow => ({
    playlistId,
    updatedAt: "2026-11-20T10:00:00Z",
    title: null,
    players: 3,
    team,
    game,
    ...over,
  });
  const space = new Set(["a", "b", "c", "d"]);

  it("finds the team's report for the game", () => {
    expect(findTeamReport([draftRow("a")], space, team, game.id)).toBe("a");
  });

  it("keeps another game's report apart", () => {
    expect(findTeamReport([draftRow("a", { game: { ...game, id: "1" } })], space, team, game.id)).toBeNull();
  });

  it("without a game, finds the report started with none", () => {
    const list = [draftRow("a"), draftRow("b", { game: null })];
    expect(findTeamReport(list, space, team, null)).toBe("b");
  });

  it("takes the newest of several", () => {
    const list = [draftRow("a"), draftRow("b", { updatedAt: "2026-11-21T10:00:00Z" })];
    expect(findTeamReport(list, space, team, game.id)).toBe("b");
  });

  it("leaves out other spaces, other teams and reports not started from a team", () => {
    const list = [
      draftRow("x"),
      draftRow("c", { team: { ...team, teamId: 8 } }),
      draftRow("d", { team: null }),
    ];
    expect(findTeamReport(list, space, team, game.id)).toBeNull();
  });
});
