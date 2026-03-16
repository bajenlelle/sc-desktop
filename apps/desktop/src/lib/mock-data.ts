import type {
  Match,
  Team,
  Player,
  PlayerStats,
  GameEvent,
  TeamStats,
} from "@/types/match";

// =============================================================================
// Teams & Rosters (based on actual AI engine config)
// =============================================================================

const fryshuset: Team = {
  id: "fryshuset",
  name: "Fryshuset Basket",
  color: "#000000",
  players: [
    { id: "f1", jerseyNumber: 1, name: "Marcus Francis", teamId: "fryshuset" },
    { id: "f5", jerseyNumber: 5, name: "Erik Lettfält", teamId: "fryshuset" },
    { id: "f6", jerseyNumber: 6, name: "Omar Dibba", teamId: "fryshuset" },
    { id: "f8", jerseyNumber: 8, name: "Ali Halling-Ibo", teamId: "fryshuset" },
    { id: "f10", jerseyNumber: 10, name: "David Odinks", teamId: "fryshuset" },
    { id: "f2", jerseyNumber: 2, name: "Nils Karlsson", teamId: "fryshuset" },
    { id: "f4", jerseyNumber: 4, name: "Yonas Ghebreab", teamId: "fryshuset" },
    { id: "f9", jerseyNumber: 9, name: "James Ilori", teamId: "fryshuset" },
    { id: "f11", jerseyNumber: 11, name: "Leo Unger", teamId: "fryshuset" },
    { id: "f13", jerseyNumber: 13, name: "Lukas Jucevicius", teamId: "fryshuset" },
  ],
};

const djurgarden: Team = {
  id: "djurgarden",
  name: "Djurgården Basket",
  color: "#272169",
  players: [
    { id: "d3", jerseyNumber: 3, name: "Tyler Jones", teamId: "djurgarden" },
    { id: "d6", jerseyNumber: 6, name: "Axel Rafstedt", teamId: "djurgarden" },
    { id: "d9", jerseyNumber: 9, name: "Karl Niklasson", teamId: "djurgarden" },
    { id: "d13", jerseyNumber: 13, name: "Anton Grytberg", teamId: "djurgarden" },
    { id: "d14", jerseyNumber: 14, name: "Hugo Von Uthmann", teamId: "djurgarden" },
    { id: "d7", jerseyNumber: 7, name: "Pelle Smeds", teamId: "djurgarden" },
    { id: "d8", jerseyNumber: 8, name: "Isak Grytberg", teamId: "djurgarden" },
    { id: "d11", jerseyNumber: 11, name: "Oskar Pernyer", teamId: "djurgarden" },
    { id: "d12", jerseyNumber: 12, name: "Emil Åhlin", teamId: "djurgarden" },
  ],
};

const alvik: Team = {
  id: "alvik",
  name: "Alvik Basket",
  color: "#dc2626",
  players: [
    { id: "a4", jerseyNumber: 4, name: "Pelle Svensson", teamId: "alvik" },
    { id: "a7", jerseyNumber: 7, name: "Johan Andersson", teamId: "alvik" },
    { id: "a11", jerseyNumber: 11, name: "Lars Bergström", teamId: "alvik" },
    { id: "a15", jerseyNumber: 15, name: "Erik Lindqvist", teamId: "alvik" },
    { id: "a22", jerseyNumber: 22, name: "Mikael Holm", teamId: "alvik" },
    { id: "a3", jerseyNumber: 3, name: "Anders Nilsson", teamId: "alvik" },
    { id: "a10", jerseyNumber: 10, name: "Viktor Ekström", teamId: "alvik" },
    { id: "a23", jerseyNumber: 23, name: "Simon Hedlund", teamId: "alvik" },
    { id: "a5", jerseyNumber: 5, name: "Oskar Lind", teamId: "alvik" },
  ],
};

const bromma: Team = {
  id: "bromma",
  name: "Bromma Basket",
  color: "#2563eb",
  players: [
    { id: "b2", jerseyNumber: 2, name: "Magnus Ohlsson", teamId: "bromma" },
    { id: "b8", jerseyNumber: 8, name: "Fredrik Sjöberg", teamId: "bromma" },
    { id: "b12", jerseyNumber: 12, name: "Gustav Nordin", teamId: "bromma" },
    { id: "b14", jerseyNumber: 14, name: "Rasmus Ek", teamId: "bromma" },
    { id: "b21", jerseyNumber: 21, name: "Henrik Wallin", teamId: "bromma" },
    { id: "b6", jerseyNumber: 6, name: "Tobias Strand", teamId: "bromma" },
    { id: "b9", jerseyNumber: 9, name: "Alexander Berg", teamId: "bromma" },
    { id: "b17", jerseyNumber: 17, name: "William Dahl", teamId: "bromma" },
  ],
};

// =============================================================================
// Player Stats
// =============================================================================

function makeStats(
  player: Player,
  actions: number,
  jsM: number,
  jsX: number,
  tpM: number,
  tpX: number,
  ftM: number,
  ftX: number,
  passes: number,
  assists: number,
  rebounds: number,
  steals: number,
  blocks: number,
  turnovers: number
): PlayerStats {
  const totalAttempts = jsM + jsX + tpM + tpX + ftM + ftX;
  const totalMade = jsM + tpM + ftM;
  return {
    playerId: player.id,
    jerseyNumber: player.jerseyNumber,
    playerName: player.name,
    teamId: player.teamId,
    totalActions: actions,
    jumpShots: { made: jsM, missed: jsX },
    threePointers: { made: tpM, missed: tpX },
    freeThrows: { made: ftM, missed: ftX },
    passes,
    assists,
    rebounds,
    steals,
    blocks,
    turnovers,
    successRate: totalAttempts > 0 ? Math.round((totalMade / totalAttempts) * 100) : 0,
  };
}

const match1Stats: PlayerStats[] = [
  makeStats(djurgarden.players[0], 18, 4, 3, 2, 1, 3, 1, 12, 5, 4, 2, 0, 1),
  makeStats(djurgarden.players[1], 14, 3, 2, 1, 2, 2, 0, 8, 3, 6, 1, 1, 2),
  makeStats(djurgarden.players[2], 22, 5, 4, 3, 2, 4, 2, 15, 7, 3, 3, 0, 1),
  makeStats(djurgarden.players[3], 10, 2, 3, 0, 1, 1, 1, 6, 2, 8, 0, 3, 0),
  makeStats(djurgarden.players[4], 16, 3, 2, 2, 3, 2, 1, 10, 4, 5, 1, 0, 3),
  makeStats(fryshuset.players[0], 20, 6, 3, 1, 2, 3, 1, 11, 4, 3, 2, 1, 2),
  makeStats(fryshuset.players[1], 12, 2, 4, 1, 1, 2, 2, 7, 2, 7, 0, 2, 1),
  makeStats(fryshuset.players[2], 15, 3, 2, 2, 3, 1, 0, 9, 6, 2, 3, 0, 2),
  makeStats(fryshuset.players[3], 19, 5, 3, 3, 1, 2, 1, 13, 5, 4, 1, 0, 1),
  makeStats(fryshuset.players[4], 8, 1, 2, 0, 2, 1, 1, 5, 1, 9, 0, 4, 0),
];

// =============================================================================
// Events
// =============================================================================

function ev(
  id: string,
  frame: number,
  ts: string,
  tsSec: number,
  player: Player,
  type: GameEvent["type"],
  outcome: GameEvent["outcome"]
): GameEvent {
  const typeLabels: Record<string, string> = {
    jump_shot: "Jump Shot",
    three_pointer: "Three-Pointer",
    free_throw: "Free Throw",
    layup: "Layup",
    pass: "Pass",
    assist: "Assist",
    rebound: "Rebound",
    steal: "Steal",
    block: "Block",
    turnover: "Turnover",
    dunk: "Dunk",
    foul: "Foul",
  };
  return {
    id,
    frameIndex: frame,
    timestamp: ts,
    timestampSeconds: tsSec,
    playerId: player.id,
    playerName: player.name,
    jerseyNumber: player.jerseyNumber,
    teamId: player.teamId,
    type,
    outcome,
    description: `${player.name} (#${player.jerseyNumber}) — ${typeLabels[type]} — ${outcome === "success" ? "Made" : outcome === "miss" ? "Missed" : outcome.charAt(0).toUpperCase() + outcome.slice(1)}`,
  };
}

const match1Events: GameEvent[] = [
  ev("e1", 120, "00:04", 4, djurgarden.players[0], "jump_shot", "success"),
  ev("e2", 450, "00:15", 15, fryshuset.players[0], "three_pointer", "miss"),
  ev("e3", 780, "00:26", 26, djurgarden.players[2], "pass", "success"),
  ev("e4", 960, "00:32", 32, djurgarden.players[2], "assist", "success"),
  ev("e5", 990, "00:33", 33, djurgarden.players[0], "layup", "success"),
  ev("e6", 1350, "00:45", 45, fryshuset.players[2], "steal", "success"),
  ev("e7", 1500, "00:50", 50, fryshuset.players[2], "jump_shot", "success"),
  ev("e8", 1890, "01:03", 63, djurgarden.players[3], "rebound", "success"),
  ev("e9", 2100, "01:10", 70, djurgarden.players[1], "three_pointer", "success"),
  ev("e10", 2550, "01:25", 85, fryshuset.players[3], "jump_shot", "miss"),
  ev("e11", 2880, "01:36", 96, fryshuset.players[0], "free_throw", "success"),
  ev("e12", 2910, "01:37", 97, fryshuset.players[0], "free_throw", "success"),
  ev("e13", 3300, "01:50", 110, djurgarden.players[4], "turnover", "turnover"),
  ev("e14", 3450, "01:55", 115, fryshuset.players[3], "layup", "success"),
  ev("e15", 3900, "02:10", 130, djurgarden.players[2], "three_pointer", "success"),
  ev("e16", 4200, "02:20", 140, fryshuset.players[1], "block", "success"),
  ev("e17", 4500, "02:30", 150, djurgarden.players[0], "jump_shot", "miss"),
  ev("e18", 4800, "02:40", 160, fryshuset.players[4], "rebound", "success"),
  ev("e19", 5100, "02:50", 170, fryshuset.players[2], "three_pointer", "success"),
  ev("e20", 5400, "03:00", 180, djurgarden.players[1], "pass", "success"),
  ev("e21", 5700, "03:10", 190, djurgarden.players[2], "jump_shot", "success"),
  ev("e22", 6000, "03:20", 200, fryshuset.players[0], "turnover", "turnover"),
  ev("e23", 6300, "03:30", 210, djurgarden.players[3], "steal", "success"),
  ev("e24", 6600, "03:40", 220, djurgarden.players[4], "three_pointer", "miss"),
  ev("e25", 7200, "04:00", 240, fryshuset.players[3], "jump_shot", "success"),
];

// =============================================================================
// Team-level Stats
// =============================================================================

const match1HomeStats: TeamStats = {
  teamId: "djurgarden",
  teamName: "Djurgården Basket",
  totalShots: 42,
  shotsMade: 22,
  shootingPercentage: 52,
  threePointPercentage: 38,
  freeThrowPercentage: 80,
  totalRebounds: 26,
  totalAssists: 21,
  totalSteals: 7,
  totalTurnovers: 5,
  possessionPercentage: 52,
};

const match1AwayStats: TeamStats = {
  teamId: "fryshuset",
  teamName: "Fryshuset Basket",
  totalShots: 38,
  shotsMade: 19,
  shootingPercentage: 50,
  threePointPercentage: 33,
  freeThrowPercentage: 75,
  totalRebounds: 25,
  totalAssists: 18,
  totalSteals: 6,
  totalTurnovers: 6,
  possessionPercentage: 48,
};

// =============================================================================
// Matches
// =============================================================================

export const mockMatches: Match[] = [
  {
    id: "1",
    title: "Djurgården vs Fryshuset",
    date: "2025-11-15",
    status: "completed",
    homeTeam: djurgarden,
    awayTeam: fryshuset,
    duration: 2400,
    fps: 30,
    frameCount: 72000,
    playerStats: match1Stats,
    events: match1Events,
    homeTeamStats: match1HomeStats,
    awayTeamStats: match1AwayStats,
  },
  {
    id: "2",
    title: "Alvik vs Bromma",
    date: "2025-11-22",
    status: "completed",
    homeTeam: alvik,
    awayTeam: bromma,
    duration: 2400,
    fps: 30,
    frameCount: 72000,
    playerStats: [],
    events: [],
    homeTeamStats: {
      teamId: "alvik",
      teamName: "Alvik Basket",
      totalShots: 45,
      shotsMade: 20,
      shootingPercentage: 44,
      threePointPercentage: 31,
      freeThrowPercentage: 72,
      totalRebounds: 30,
      totalAssists: 15,
      totalSteals: 5,
      totalTurnovers: 8,
      possessionPercentage: 47,
    },
    awayTeamStats: {
      teamId: "bromma",
      teamName: "Bromma Basket",
      totalShots: 48,
      shotsMade: 24,
      shootingPercentage: 50,
      threePointPercentage: 36,
      freeThrowPercentage: 78,
      totalRebounds: 28,
      totalAssists: 19,
      totalSteals: 7,
      totalTurnovers: 6,
      possessionPercentage: 53,
    },
  },
  {
    id: "3",
    title: "Fryshuset vs Alvik",
    date: "2025-12-01",
    status: "processing",
    homeTeam: fryshuset,
    awayTeam: alvik,
  },
  {
    id: "4",
    title: "Bromma vs Djurgården",
    date: "2025-12-08",
    status: "pending",
    homeTeam: bromma,
    awayTeam: djurgarden,
  },
];

export function getMatchById(id: string): Match | undefined {
  return mockMatches.find((m) => m.id === id);
}
