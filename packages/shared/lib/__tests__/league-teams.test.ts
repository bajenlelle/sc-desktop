import { describe, expect, it } from "vitest";
import {
  alsoUseLabel,
  choiceFor,
  currentTeams,
  groupChoicesForProfile,
  groupTeams,
  needsTeamStep,
  searchTeams,
  spaceListLabel,
  spacesSharingAnswer,
  spacesWithoutChoice,
  teamRoleIn,
  teamRoleLine,
  teamSpaces,
  teamStepTitle,
} from "../league-teams";
import type { LeagueTeam, TeamChoice } from "../../types/league-team";
import type { OrgMembership } from "../../types/org";

const team = (over: Partial<LeagueTeam>): LeagueTeam => ({
  id: "t",
  name: "Team",
  clubName: null,
  clubKey: null,
  gender: "men",
  leagueId: "superettan-herr",
  leagueName: "Superettan Herr",
  seasonId: "2026-27",
  logoUrl: null,
  ...over,
});

const om = (over: Partial<OrgMembership>): OrgMembership => ({
  orgId: "o",
  orgName: "Org",
  role: "coach",
  isNtOrg: false,
  planTier: "free",
  isPersonal: false,
  ...over,
});

const choice = (orgId: string, t: LeagueTeam | null, unlistedTeam: string | null = null): TeamChoice => ({
  orgId,
  team: t,
  unlistedTeam,
  updatedAt: "2026-10-07T10:00:00Z",
});

const sollentuna = team({ id: "sol", name: "Sollentuna Basket", clubName: "Sollentuna Basketklubb", clubKey: "genius:25538" });
const sollentunaDam = team({ id: "sol-d", name: "Sollentuna Basket", clubName: "Sollentuna Basketklubb", clubKey: "genius:25538", gender: "women", leagueId: "basketettan-dam", leagueName: "Basketettan Dam" });
const umea = team({ id: "ume", name: "Umeå Basket", clubName: "KFUM UMEÅ BSKT", leagueId: "sbl-herr", leagueName: "SBL Herr" });
const malbas = team({ id: "mal", name: "Malbas", leagueId: "sbl-dam", leagueName: "SBL Dam", gender: "women", seasonId: "2025-26" });
const lulea = team({ id: "lul", name: "Luleå BBK", leagueId: "sbl-dam", leagueName: "SBL Dam", gender: "women" });

const club = om({ orgId: "club", orgName: "Sollentuna Basketklubb", role: "player" });
const club2 = om({ orgId: "club2", orgName: "Alvik", role: "admin" });
const personal = om({ orgId: "me", orgName: "Leonard", role: "admin", isPersonal: true });

describe("currentTeams", () => {
  it("keeps only teams seen in their league's newest season", () => {
    expect(currentTeams([sollentuna, malbas, lulea]).map((t) => t.id)).toEqual(["sol", "lul"]);
  });

  it("keeps a league that has not rolled over yet", () => {
    const old = team({ id: "old", leagueId: "x", seasonId: "2025-26" });
    expect(currentTeams([old, sollentuna]).map((t) => t.id)).toEqual(["old", "sol"]);
  });
});

describe("searchTeams", () => {
  const all = [sollentuna, sollentunaDam, umea, lulea];

  it("returns everything for an empty query", () => {
    expect(searchTeams(all, "  ")).toHaveLength(4);
  });

  it("ignores case and accents", () => {
    expect(searchTeams(all, "UMEA").map((t) => t.id)).toEqual(["ume"]);
    expect(searchTeams(all, "lulea").map((t) => t.id)).toEqual(["lul"]);
  });

  it("matches the club and the league, every word", () => {
    expect(searchTeams(all, "basketklubb dam").map((t) => t.id)).toEqual(["sol-d"]);
    expect(searchTeams(all, "sbl").map((t) => t.id)).toEqual(["ume", "lul"]);
  });
});

describe("groupTeams", () => {
  it("lists the club's teams first, then leagues in catalogue order", () => {
    const sections = groupTeams([lulea, umea, sollentunaDam, sollentuna], new Set(["sol", "sol-d"]));
    expect(sections.map((s) => (s.kind === "club" ? "club" : s.leagueId))).toEqual(["club", "sbl-herr", "sbl-dam"]);
    expect(sections[0].teams.map((t) => t.id)).toEqual(["sol", "sol-d"]); // club teams follow league order
  });

  it("sorts teams by name within a league", () => {
    const b = team({ id: "b", name: "Brahe" });
    const a = team({ id: "a", name: "Alvik" });
    expect(groupTeams([b, a], new Set())[0].teams.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("puts unknown leagues after known ones, alphabetically", () => {
    const x = team({ id: "x", leagueId: "zz", leagueName: "Allsvenskan" });
    const y = team({ id: "y", leagueId: "yy", leagueName: "Division 1" });
    const sections = groupTeams([y, x, umea], new Set());
    expect(sections.map((s) => (s.kind === "league" ? s.leagueName : "club"))).toEqual(["SBL Herr", "Allsvenskan", "Division 1"]);
  });

  it("has no club section without suggestions", () => {
    expect(groupTeams([umea], new Set()).every((s) => s.kind === "league")).toBe(true);
  });
});

describe("needsTeamStep", () => {
  it("is true only while the active space has no answer", () => {
    expect(needsTeamStep([], "club")).toBe(true);
    expect(needsTeamStep([choice("club", null)], "club")).toBe(false); // skipped counts as answered
    expect(needsTeamStep([choice("me", sollentuna)], "club")).toBe(true);
    expect(needsTeamStep([], null)).toBe(false);
  });

  it("finds a space's choice", () => {
    expect(choiceFor([choice("club", sollentuna)], "club")?.team?.id).toBe("sol");
    expect(choiceFor([], "club")).toBeNull();
  });
});

describe("roles and copy", () => {
  it("uses the membership role in a club space and the declared role in the personal space", () => {
    expect(teamRoleIn(club, "coach")).toBe("player");
    expect(teamRoleIn(club2, "player")).toBe("coach");
    expect(teamRoleIn(personal, "player")).toBe("player");
    expect(teamRoleIn(personal, null)).toBeNull();
    expect(teamRoleIn(undefined, "coach")).toBe("coach");
  });

  it("asks the question for the role", () => {
    expect(teamStepTitle("coach")).toBe("Which team do you coach?");
    expect(teamStepTitle("player")).toBe("Which team do you play for?");
    expect(teamStepTitle(null)).toBe("Which team are you part of?");
    expect(teamRoleLine("coach")).toBe("You coach this team");
    expect(teamRoleLine("player")).toBe("You play for this team");
    expect(teamRoleLine(null)).toBeNull();
  });

  it("names spaces as places", () => {
    expect(spaceListLabel([club])).toBe("Sollentuna Basketklubb");
    expect(spaceListLabel([club, personal])).toBe("Sollentuna Basketklubb and your personal space");
    expect(spaceListLabel([club, club2, personal])).toBe("Sollentuna Basketklubb, Alvik and your personal space");
    expect(alsoUseLabel(personal)).toBe("Also use this team in your personal space");
    expect(alsoUseLabel(club)).toBe("Also use this team in Sollentuna Basketklubb");
  });
});

describe("spaces for the checkboxes", () => {
  const orgs = [club, club2, personal];

  it("offers every other space that has no answer yet", () => {
    expect(spacesWithoutChoice(orgs, [choice("club2", umea)], "club").map((o) => o.orgId)).toEqual(["me"]);
    expect(spacesWithoutChoice(orgs, [], "me").map((o) => o.orgId)).toEqual(["club", "club2"]);
  });

  it("pre-selects the spaces that share the answer being changed", () => {
    const choices = [choice("club", sollentuna), choice("me", sollentuna), choice("club2", umea)];
    expect(spacesSharingAnswer(orgs, choices, "club")).toEqual(["club", "me"]);
    expect(spacesSharingAnswer(orgs, choices, "club2")).toEqual(["club2"]);
  });

  it("treats spaces without a team as sharing the empty answer", () => {
    expect(spacesSharingAnswer(orgs, [choice("club", null)], "club")).toEqual(["club", "club2", "me"]);
  });
});

describe("groupChoicesForProfile", () => {
  it("shows one row when every space uses the same team", () => {
    const rows = groupChoicesForProfile([club, personal], [choice("club", sollentuna), choice("me", sollentuna)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].team?.id).toBe("sol");
    expect(rows[0].orgs.map((o) => o.orgId)).toEqual(["club", "me"]);
  });

  it("shows a row per answer, with unanswered spaces together and last", () => {
    const rows = groupChoicesForProfile(
      [club, club2, personal],
      [choice("me", umea), choice("club", null, "Sollentuna U16, Div 2")],
    );
    expect(rows.map((r) => r.key)).toEqual(["note:sollentuna u16, div 2", "team:ume", "none"]);
    expect(rows[2].orgs.map((o) => o.orgId)).toEqual(["club2"]);
  });
});

describe("teamSpaces", () => {
  it("leaves out national-team spaces, which have no league team", () => {
    const nt = om({ orgId: "nt", orgName: "Sweden", isNtOrg: true });
    expect(teamSpaces([club, nt, personal]).map((o) => o.orgId)).toEqual(["club", "me"]);
  });
});
