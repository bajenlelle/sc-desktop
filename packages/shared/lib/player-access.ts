/**
 * Player passes: what a Free personal space may import and export, and what
 * the purchase sheet offers. A player buys a single game (any game) or goes
 * Pro; a bought game opens export for all of their games (a Pro subscription
 * doesn't once it ends). The season pass (every game of one team in one season) is
 * dormant since 2026-10-23 (`app_config.season_pass_enabled`): the sheet no
 * longer offers it, and only an existing pass still shows.
 *
 * Display only. The import trigger (`_game_access` in
 * supabase/migrations/20261027100000_player_passes.sql) makes the decision,
 * and Stripe's prices are what's charged — keep these prices in step with
 * them.
 */
import type { OrgPlanTier } from "../types/org";

/** Prices in SEK, VAT included. */
export const PLAYER_PRICES = { singleGame: 129 } as const;

/** Pro, sold on scoutable.se: SEK a month, or a year paid at once. */
export const PRO_PRICES = { monthly: 399, yearly: 2990 } as const;

/** What paid for a logged game (`import_log.via`). */
export type ImportVia = "trial" | "single" | "season_pass" | "plan" | "exempt";
export type PurchaseKind = "single_game" | "season_pass";

export interface SeasonPass {
  id: string;
  seasonId: string;
  teamId: string;
  teamName: string;
  leagueName: string;
  movesLeft: number;
  status: "active" | "refunded";
  createdAt: string;
}

export interface PlayerPurchase {
  id: string;
  kind: PurchaseKind;
  quantity: number;
  /** Öre, VAT included. */
  amountTotal: number;
  currency: string;
  status: "paid" | "refunded";
  source: "stripe" | "admin";
  receiptUrl: string | null;
  createdAt: string;
}

/** The personal space's "Your team". */
export interface PlayerTeam {
  id: string;
  name: string;
  leagueName: string;
  /** The team has games in the season on sale, so a pass can be sold for it. */
  inSeasonOnSale: boolean;
  /** Scheduled games in the season on sale (playoffs count once drawn). */
  gamesInSeason: number;
}

/** `get_my_player_access()`. */
export interface PlayerAccess {
  /** Sales are on (`app_config.player_pass_enabled`). */
  enabled: boolean;
  /** The season pass is on sale too (`app_config.season_pass_enabled`); off since 2026-10-23. */
  passEnabled: boolean;
  seasonOnSale: string | null;
  personalOrgId: string | null;
  /** Bought a game or a pass (not refunded). A past subscription doesn't count. */
  hasPaid: boolean;
  /** Free games including refill grants. */
  trialGames: number;
  trialLeft: number;
  singlesLeft: number;
  team: PlayerTeam | null;
  passes: SeasonPass[];
  purchases: PlayerPurchase[];
}

/** `check_game_access(org, game)`. */
export interface GameAccess {
  allowed: boolean;
  via: ImportVia | null;
  imported: boolean;
  /** One of "Your team"'s games in this space. */
  ownTeam: boolean;
  /** The team of the pass that covers it, if one does. */
  passTeam: string | null;
  /** A pass can be bought that would cover this game. */
  passAvailable: boolean;
  singleAvailable: boolean;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v.filter((x) => obj(x)) as Raw[]) : []);

const IMPORT_VIAS: ImportVia[] = ["trial", "single", "season_pass", "plan", "exempt"];

export function parsePlayerAccess(raw: unknown): PlayerAccess {
  const r = obj(raw) ?? {};
  const team = obj(r.team);
  return {
    enabled: bool(r.enabled),
    passEnabled: bool(r.pass_enabled),
    seasonOnSale: str(r.season_on_sale) || null,
    personalOrgId: str(r.personal_org_id) || null,
    hasPaid: bool(r.has_paid),
    trialGames: num(r.trial_games),
    trialLeft: num(r.trial_left),
    singlesLeft: num(r.singles_left),
    team: team
      ? {
          id: str(team.id),
          name: str(team.name),
          leagueName: str(team.league_name),
          inSeasonOnSale: bool(team.in_season_on_sale),
          gamesInSeason: num(team.games_in_season),
        }
      : null,
    passes: arr(r.passes).map((p) => ({
      id: str(p.id),
      seasonId: str(p.season_id),
      teamId: str(p.team_id),
      teamName: str(p.team_name),
      leagueName: str(p.league_name),
      movesLeft: num(p.moves_left),
      status: p.status === "refunded" ? "refunded" : "active",
      createdAt: str(p.created_at),
    })),
    purchases: arr(r.purchases).map((p) => ({
      id: str(p.id),
      kind: p.kind === "season_pass" ? "season_pass" : "single_game",
      quantity: num(p.quantity) || 1,
      amountTotal: num(p.amount_total),
      currency: str(p.currency) || "sek",
      status: p.status === "refunded" ? "refunded" : "paid",
      source: p.source === "admin" ? "admin" : "stripe",
      receiptUrl: str(p.receipt_url) || null,
      createdAt: str(p.created_at),
    })),
  };
}

export function parseGameAccess(raw: unknown): GameAccess {
  const r = obj(raw) ?? {};
  const via = IMPORT_VIAS.find((v) => v === r.via) ?? null;
  return {
    allowed: bool(r.allowed),
    via,
    imported: bool(r.imported),
    ownTeam: bool(r.own_team),
    passTeam: str(r.pass_team) || null,
    passAvailable: bool(r.pass_available),
    singleAvailable: bool(r.single_available),
  };
}

/** "2026-27" → "2026/27". */
export function seasonLabel(seasonId: string): string {
  return seasonId.replace("-", "/");
}

/** The live pass for a season (the season on sale by default). */
export function activePass(access: PlayerAccess, seasonId = access.seasonOnSale): SeasonPass | null {
  if (!seasonId) return null;
  return access.passes.find((p) => p.status === "active" && p.seasonId === seasonId) ?? null;
}

/**
 * Export, 9:16 export and send to phone. Paid plans always may; a Free space
 * may once its owner has bought anything (the founder's rule: any purchase
 * opens export for all their games).
 */
export function canExport(tier: OrgPlanTier, access: PlayerAccess | null): boolean {
  return tier !== "free" || !!access?.hasPaid;
}

/**
 * What importing a game takes from what is left: "Uses 1 of 3 free games",
 * "Uses your last free game". The badge names the cost of this import; the
 * total left (free and bought) is playerMeterLabel's job.
 */
function usesLabel(left: number, kind: "free" | "bought"): string {
  return left === 1 ? `Uses your last ${kind} game` : `Uses 1 of ${left} ${kind} games`;
}

export type GameBadgeTone = "covered" | "free" | "bought" | "imported" | "price";
export interface GameBadge {
  label: string;
  tone: GameBadgeTone;
}

/**
 * The badge on a game in the import list: what importing it would use.
 * Null where nothing needs saying (paid spaces, or sales off and allowed).
 */
export function gameBadge(game: GameAccess, access: PlayerAccess): GameBadge | null {
  if (game.imported) return { label: "Imported", tone: "imported" };
  switch (game.via) {
    case "season_pass":
      return { label: "In your season pass", tone: "covered" };
    case "trial":
      return { label: usesLabel(access.trialLeft, "free"), tone: "free" };
    case "single":
      return { label: usesLabel(access.singlesLeft, "bought"), tone: "bought" };
    case "plan":
    case "exempt":
      return null;
    default:
      return game.singleAvailable ? { label: `${PLAYER_PRICES.singleGame} kr`, tone: "price" } : null;
  }
}

/**
 * The badge for a game in a list, from what the client already knows: is it
 * imported, and does the live pass cover it (one of the game's team ids is
 * the pass team's in the pass's season). The same order as the import
 * trigger: pass, free game, bought game, otherwise the single price.
 */
export function importBadge(game: { imported: boolean; covered: boolean }, access: PlayerAccess): GameBadge | null {
  if (game.imported) return { label: "Imported", tone: "imported" };
  if (game.covered) return { label: "In your season pass", tone: "covered" };
  if (access.trialLeft > 0) return { label: usesLabel(access.trialLeft, "free"), tone: "free" };
  if (access.singlesLeft > 0) return { label: usesLabel(access.singlesLeft, "bought"), tone: "bought" };
  return access.enabled ? { label: `${PLAYER_PRICES.singleGame} kr`, tone: "price" } : null;
}

export type SheetOfferKind = PurchaseKind | "pro";
export interface SheetOffer {
  kind: SheetOfferKind;
  /** SEK, VAT included; Pro is per month. */
  price: number;
  title: string;
  detail: string;
}

/** "2 990 kr", the way formatKronor prints whole kronor. */
function kronor(sek: number): string {
  return `${sek.toLocaleString("sv-SE")} kr`;
}

/**
 * What the purchase sheet offers, in order: a single game and Pro (the
 * season pass is no longer sold). `game` is the game that hit the limit
 * (null when the sheet opens from export). Coaches see Pro first, with the
 * yearly price. Empty while sales are off: the caller shows the old upgrade
 * dialog.
 */
export function sheetOffers(
  game: GameAccess | null,
  access: PlayerAccess,
  role: "coach" | "player" | null,
): SheetOffer[] {
  if (!access.enabled) return [];

  const opensExport = access.hasPaid ? "" : " Also opens export for all your games.";
  const single: SheetOffer = game
    ? {
        kind: "single_game",
        price: PLAYER_PRICES.singleGame,
        title: "This game",
        detail: `Yours to keep.${opensExport}`,
      }
    : {
        kind: "single_game",
        price: PLAYER_PRICES.singleGame,
        title: "One game",
        detail: `One more game to import, yours to keep.${opensExport}`,
      };

  const pro: SheetOffer = {
    kind: "pro",
    price: PRO_PRICES.monthly,
    title: "Pro",
    detail:
      role === "coach"
        ? `Every game, any team. Or ${kronor(PRO_PRICES.yearly)} a year.`
        : "Every game, any team. Cancel anytime.",
  };
  return role === "coach" ? [pro, single] : [single, pro];
}

/** Single games bought in the 30 days before `now` (paid, quantities added up). */
export function singlesInLast30Days(access: PlayerAccess, now: Date = new Date()): number {
  const since = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return access.purchases
    .filter((p) => p.kind === "single_game" && p.status === "paid" && Date.parse(p.createdAt) >= since)
    .reduce((n, p) => n + p.quantity, 0);
}

/**
 * The line under the sheet's offers that points at Pro: from the game where
 * singles bought within 30 days would cost more than a month of Pro. Once two
 * or more singles are bought, it prices the next one against Pro.
 */
export function proNudge(access: PlayerAccess, now: Date = new Date()): string | null {
  if (!access.enabled) return null;
  const { singleGame } = PLAYER_PRICES;
  const bought = singlesInLast30Days(access, now);
  if (bought >= 2) {
    const next = bought + 1;
    return `${next} games: ${kronor(next * singleGame)}. Pro: ${kronor(PRO_PRICES.monthly)} for every game this month.`;
  }
  const crossover = Math.floor(PRO_PRICES.monthly / singleGame) + 1;
  return `From your ${ordinal(crossover)} game in a month, Pro costs less.`;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** One line for the space switcher and profile meters. */
export function playerMeterLabel(access: PlayerAccess): string {
  const pass = activePass(access);
  if (pass) return `Season pass · ${pass.teamName}`;
  const { trialLeft, trialGames, singlesLeft } = access;
  if (trialLeft > 0 && singlesLeft > 0) {
    return `${trialLeft + singlesLeft} games left: ${trialLeft} free, ${singlesLeft} bought`;
  }
  if (singlesLeft > 0) return `${singlesLeft} bought ${singlesLeft === 1 ? "game" : "games"} left`;
  if (trialLeft > 0) return `${trialLeft} of ${trialGames} free ${trialGames === 1 ? "game" : "games"} left`;
  return "No games left";
}

/** Paid purchases of a kind, for noticing that a checkout finished. */
export function paidCount(access: PlayerAccess | null, kind?: PurchaseKind): number {
  if (!access) return 0;
  return access.purchases.filter((p) => p.status === "paid" && (!kind || p.kind === kind)).length;
}

/** True once a purchase of `kind` has arrived since `before` was read. */
export function purchaseArrived(before: PlayerAccess | null, after: PlayerAccess, kind: PurchaseKind): boolean {
  return paidCount(after, kind) > paidCount(before, kind);
}

/** "799 kr" from öre. */
export function formatKronor(ore: number): string {
  return `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
}

/** "Season pass", "Single game", "3 single games". */
export function purchaseLabel(p: PlayerPurchase): string {
  if (p.kind === "season_pass") return "Season pass";
  return p.quantity > 1 ? `${p.quantity} single games` : "Single game";
}
