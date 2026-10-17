import { describe, expect, it } from "vitest";
import {
  activePass,
  canExport,
  formatKronor,
  gameBadge,
  importBadge,
  parseGameAccess,
  parsePlayerAccess,
  passNotOfferedReason,
  passValueLine,
  playerMeterLabel,
  purchaseArrived,
  purchaseLabel,
  seasonLabel,
  sheetOffers,
  watermarkForced,
  type GameAccess,
  type PlayerAccess,
} from "../player-access";

// The shapes get_my_player_access() and check_game_access() return
// (20261017100000_player_passes.sql).
const RAW_ACCESS = {
  enabled: true,
  season_on_sale: "2026-27",
  personal_org_id: "org-1",
  has_paid: false,
  trial_games: 2,
  trial_left: 1,
  singles_left: 0,
  team: {
    id: "team-a",
    name: "Fryshuset Basket",
    league_name: "Superettan Herr",
    in_season_on_sale: true,
    games_in_season: 26,
  },
  passes: [],
  purchases: [],
};

function access(over: Partial<PlayerAccess> = {}): PlayerAccess {
  return { ...parsePlayerAccess(RAW_ACCESS), ...over };
}

function game(over: Partial<GameAccess> = {}): GameAccess {
  return {
    allowed: false,
    via: null,
    imported: false,
    ownTeam: true,
    passTeam: null,
    passAvailable: true,
    singleAvailable: true,
    ...over,
  };
}

const PASS = {
  id: "pass-1",
  seasonId: "2026-27",
  teamId: "team-a",
  teamName: "Fryshuset Basket",
  leagueName: "Superettan Herr",
  movesLeft: 1,
  status: "active" as const,
  createdAt: "2026-10-17T10:00:00Z",
};

describe("parsePlayerAccess", () => {
  it("maps the RPC's snake_case fields", () => {
    const a = parsePlayerAccess({
      ...RAW_ACCESS,
      passes: [{ id: "p", season_id: "2026-27", team_id: "t", team_name: "T", league_name: "L", moves_left: 0, status: "active", created_at: "x" }],
      purchases: [{ id: "u", kind: "season_pass", quantity: 1, amount_total: 99900, currency: "sek", status: "paid", source: "stripe", receipt_url: "https://r", created_at: "y" }],
    });
    expect(a.trialGames).toBe(2);
    expect(a.team?.gamesInSeason).toBe(26);
    expect(a.passes[0]).toMatchObject({ seasonId: "2026-27", movesLeft: 0, status: "active" });
    expect(a.purchases[0]).toMatchObject({ kind: "season_pass", amountTotal: 99900, receiptUrl: "https://r" });
  });

  it("survives a missing or malformed payload", () => {
    const a = parsePlayerAccess(null);
    expect(a.enabled).toBe(false);
    expect(a.team).toBeNull();
    expect(a.passes).toEqual([]);
  });
});

describe("parseGameAccess", () => {
  it("keeps known vias and drops unknown ones", () => {
    expect(parseGameAccess({ allowed: true, via: "season_pass" }).via).toBe("season_pass");
    expect(parseGameAccess({ allowed: true, via: "bogus" }).via).toBeNull();
  });
});

describe("seasonLabel", () => {
  it("prints the season the way the app does", () => {
    expect(seasonLabel("2026-27")).toBe("2026/27");
  });
});

describe("export", () => {
  it("opens for paid plans, and for a Free space once anything is bought", () => {
    expect(canExport("pro", null)).toBe(true);
    expect(canExport("rookie", null)).toBe(true);
    expect(canExport("free", access())).toBe(false);
    expect(canExport("free", access({ hasPaid: true }))).toBe(true);
  });

  it("forces the mark for Rookie and for pass or single buyers, not for Pro", () => {
    expect(watermarkForced("rookie", null)).toBe(true);
    expect(watermarkForced("free", access({ hasPaid: true }))).toBe(true);
    expect(watermarkForced("free", access())).toBe(false);
    expect(watermarkForced("pro", access({ hasPaid: true }))).toBe(false);
  });
});

describe("passValueLine", () => {
  it("prices the pass per game of the team's season", () => {
    expect(passValueLine(26)).toBe("26 games · 38 kr a game");
    expect(passValueLine(33)).toBe("33 games · 30 kr a game");
  });

  it("says nothing without a schedule", () => {
    expect(passValueLine(0)).toBeNull();
  });
});

describe("gameBadge", () => {
  it("names what importing the game would use", () => {
    const a = access({ trialLeft: 2, singlesLeft: 1 });
    expect(gameBadge(game({ allowed: true, via: "season_pass" }), a)?.label).toBe("In your season pass");
    expect(gameBadge(game({ allowed: true, via: "trial" }), a)?.label).toBe("Free game · 2 left");
    expect(gameBadge(game({ allowed: true, via: "single" }), a)?.label).toBe("Uses 1 bought game · 1 left");
    expect(gameBadge(game({ allowed: true, via: "season_pass", imported: true }), a)?.label).toBe("Imported");
  });

  it("shows the single price when nothing pays for the game", () => {
    expect(gameBadge(game(), access())).toEqual({ label: "129 kr", tone: "price" });
  });

  it("stays quiet in paid spaces and while sales are off", () => {
    expect(gameBadge(game({ allowed: true, via: "plan" }), access())).toBeNull();
    expect(gameBadge(game({ singleAvailable: false }), access())).toBeNull();
  });
});

describe("sheetOffers", () => {
  it("offers this game and the season pass for an own-team game, then Pro", () => {
    const offers = sheetOffers(game(), access(), "player");
    expect(offers.map((o) => o.kind)).toEqual(["single_game", "season_pass", "pro"]);
    expect(offers[1].title).toBe("Season pass 2026/27");
    expect(offers[1].detail).toContain("Every Fryshuset Basket game this season");
    expect(offers[1].detail).toContain("38 kr a game");
  });

  it("leaves the pass out for another team's game", () => {
    const offers = sheetOffers(game({ ownTeam: false, passAvailable: false }), access(), "player");
    expect(offers.map((o) => o.kind)).toEqual(["single_game", "pro"]);
  });

  it("puts Pro first for coaches", () => {
    expect(sheetOffers(game(), access(), "coach")[0].kind).toBe("pro");
  });

  it("from export: offers the pass when the team can have one", () => {
    expect(sheetOffers(null, access(), "player").map((o) => o.kind)).toEqual(["single_game", "season_pass", "pro"]);
    expect(sheetOffers(null, access({ passes: [PASS] }), "player").map((o) => o.kind)).toEqual(["single_game", "pro"]);
  });

  it("mentions export only until something is bought", () => {
    expect(sheetOffers(game(), access(), null)[0].detail).toContain("opens export");
    expect(sheetOffers(game(), access({ hasPaid: true }), null)[0].detail).not.toContain("export");
  });

  it("offers nothing while sales are off", () => {
    expect(sheetOffers(game(), access({ enabled: false }), "player")).toEqual([]);
  });
});

describe("passNotOfferedReason", () => {
  it("explains a missing pass offer", () => {
    expect(passNotOfferedReason(game({ ownTeam: false, passAvailable: false }), access())).toBe(
      "The season pass covers Fryshuset Basket games only.",
    );
    expect(passNotOfferedReason(game({ passAvailable: false }), access({ team: null }))).toBe(
      "Set your team to see the season pass.",
    );
    expect(passNotOfferedReason(game(), access())).toBeNull();
  });
});

describe("playerMeterLabel", () => {
  it("leads with the season pass", () => {
    expect(playerMeterLabel(access({ passes: [PASS] }))).toBe("Season pass · Fryshuset Basket");
  });

  it("counts what is left, remaining first", () => {
    expect(playerMeterLabel(access({ trialLeft: 1, trialGames: 2 }))).toBe("1 of 2 free games left");
    expect(playerMeterLabel(access({ trialLeft: 0, singlesLeft: 2 }))).toBe("2 bought games left");
    expect(playerMeterLabel(access({ trialLeft: 1, singlesLeft: 1 }))).toBe("1 free and 1 bought games left");
    expect(playerMeterLabel(access({ trialLeft: 0, singlesLeft: 0 }))).toBe("No games left");
  });

  it("ignores a refunded or past-season pass", () => {
    expect(playerMeterLabel(access({ passes: [{ ...PASS, status: "refunded" }], trialLeft: 0 }))).toBe("No games left");
    expect(activePass(access({ passes: [{ ...PASS, seasonId: "2025-26" }] }))).toBeNull();
  });
});

describe("purchaseArrived", () => {
  it("notices a new paid purchase of the expected kind", () => {
    const before = access();
    const after = access({
      purchases: [{ id: "u", kind: "single_game", quantity: 1, amountTotal: 12900, currency: "sek", status: "paid", source: "stripe", receiptUrl: null, createdAt: "z" }],
    });
    expect(purchaseArrived(before, after, "single_game")).toBe(true);
    expect(purchaseArrived(before, after, "season_pass")).toBe(false);
    expect(purchaseArrived(after, after, "single_game")).toBe(false);
  });
});

describe("formatKronor", () => {
  it("prints whole kronor", () => {
    expect(formatKronor(99900)).toBe("999 kr");
    expect(formatKronor(12900)).toBe("129 kr");
  });
});

describe("purchaseLabel", () => {
  it("names each purchase", () => {
    const base = { id: "u", amountTotal: 0, currency: "sek", status: "paid" as const, source: "admin" as const, receiptUrl: null, createdAt: "z" };
    expect(purchaseLabel({ ...base, kind: "season_pass", quantity: 1 })).toBe("Season pass");
    expect(purchaseLabel({ ...base, kind: "single_game", quantity: 1 })).toBe("Single game");
    expect(purchaseLabel({ ...base, kind: "single_game", quantity: 3 })).toBe("3 single games");
  });
});

describe("importBadge", () => {
  it("follows the import trigger's order", () => {
    const a = access({ trialLeft: 1, singlesLeft: 2 });
    expect(importBadge({ imported: true, covered: true }, a)?.label).toBe("Imported");
    expect(importBadge({ imported: false, covered: true }, a)?.label).toBe("In your season pass");
    expect(importBadge({ imported: false, covered: false }, a)?.label).toBe("Free game · 1 left");
    expect(importBadge({ imported: false, covered: false }, access({ trialLeft: 0, singlesLeft: 2 }))?.label).toBe(
      "Uses 1 bought game · 2 left",
    );
    expect(importBadge({ imported: false, covered: false }, access({ trialLeft: 0 }))).toEqual({ label: "129 kr", tone: "price" });
  });
});
