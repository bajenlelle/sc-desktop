import { describe, expect, it } from "vitest";
import {
  PLAYER_NOTE_LIMIT,
  PLAYER_NOTE_STORED_MAX,
  isPlayerCard,
  newPlayerCard,
  parsePlayerCard,
  playerCardLabel,
  playerCardsOf,
  withPlayerNote,
  withoutPlayerCards,
} from "../player-card";
import type { SeasonStatsCard } from "../stats-card";
import type { PlaylistClipItem, PlaylistItem, PlaylistTextCard } from "../../types/match";

const player = { id: "1693025", name: "Alva Berg", number: "7", teamId: "187005", teamName: "Bajen Basket" };

const season: SeasonStatsCard = {
  type: "stats",
  v: 1,
  source: "genius_hosted",
  scope: "season",
  player,
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

describe("parsePlayerCard", () => {
  it("reads back what newPlayerCard wrote, stats included", () => {
    const spec = { ...newPlayerCard(player, season), note: "Drives left, hates contact." };
    expect(parsePlayerCard(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });

  it("keeps a card without stats (a league with none)", () => {
    const spec = newPlayerCard(player, null);
    expect(parsePlayerCard(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
    expect(parsePlayerCard({ ...spec, stats: undefined })?.stats).toBeNull();
  });

  it("rejects what isn't a version 1 player card", () => {
    expect(parsePlayerCard(null)).toBeNull();
    expect(parsePlayerCard("player")).toBeNull();
    expect(parsePlayerCard({ ...newPlayerCard(player, null), v: 2 })).toBeNull();
    expect(parsePlayerCard({ ...newPlayerCard(player, null), type: "stats" })).toBeNull();
    expect(parsePlayerCard({ type: "player", v: 1, player: { id: 5, name: "Alva" }, note: "" })).toBeNull();
    expect(parsePlayerCard({ type: "player", v: 1, note: "" })).toBeNull();
  });

  it("keeps the player and the note when the stats snapshot can't be read", () => {
    const parsed = parsePlayerCard({ ...newPlayerCard(player, season), stats: { ...season, v: 9 }, note: "Left hand" });
    expect(parsed).toMatchObject({ player, note: "Left hand", stats: null });
  });

  it("fills a missing number, team and note", () => {
    const parsed = parsePlayerCard({ type: "player", v: 1, player: { id: "9", name: "Ola Nilsson" } });
    expect(parsed).toMatchObject({ player: { id: "9", name: "Ola Nilsson", number: null, teamId: null, teamName: "" }, note: "" });
  });

  it("holds a stored note to the storage cap", () => {
    const parsed = parsePlayerCard({ ...newPlayerCard(player, null), note: "x".repeat(PLAYER_NOTE_STORED_MAX + 500) });
    expect(parsed?.note).toHaveLength(PLAYER_NOTE_STORED_MAX);
  });
});

describe("withPlayerNote", () => {
  it("holds a typed note to the inspector's limit", () => {
    const spec = withPlayerNote(newPlayerCard(player, null), "y".repeat(PLAYER_NOTE_LIMIT + 50));
    expect(spec.note).toHaveLength(PLAYER_NOTE_LIMIT);
  });
});

describe("playerCardLabel", () => {
  it("leads with the number when there is one", () => {
    expect(playerCardLabel({ player })).toBe("#7 Alva Berg");
    expect(playerCardLabel({ player: { ...player, number: null } })).toBe("Alva Berg");
  });
});

describe("player cards among playlist items", () => {
  const spec = newPlayerCard(player, null);
  const card: PlaylistTextCard = { type: "text", id: "p1", text: "#7 Alva Berg", durationSeconds: 0, player: spec };
  const text: PlaylistTextCard = { type: "text", id: "t1", text: "Box out", durationSeconds: 4 };
  const clip: PlaylistClipItem = { type: "clip", matchId: "m1", eventId: 1 };
  const items: PlaylistItem[] = [clip, card, text];

  it("tells a player card from a text card and a clip", () => {
    expect(isPlayerCard(card)).toBe(true);
    expect(isPlayerCard(text)).toBe(false);
    expect(isPlayerCard(clip)).toBe(false);
  });

  it("lists the player cards, and leaves them out of what plays", () => {
    expect(playerCardsOf(items)).toEqual([card]);
    expect(withoutPlayerCards(items)).toEqual([clip, text]);
  });
});
