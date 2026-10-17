/**
 * Player passes: what a Free personal space may import and export, and what
 * the purchase sheet offers. A player buys a single game (any game) or a
 * season pass (every game of one team in one season); any purchase opens
 * export for all of their games.
 *
 * Display only. The import trigger (`_game_access` in
 * supabase/migrations/20261017100000_player_passes.sql) makes the decision,
 * and Stripe's prices are what's charged — keep PLAYER_PRICES in step with
 * them.
 */
import type { OrgPlanTier } from "../types/org";

/** Prices in SEK, VAT included. */
export const PLAYER_PRICES = { singleGame: 129, seasonPass: 999 } as const;

/** Pro's monthly price, for the coach line in the purchase sheet. */
export const PRO_MONTHLY_PRICE = 399;

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
  seasonOnSale: string | null;
  personalOrgId: string | null;
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

/** The Scoutable mark is always on for Rookie and for pass and single buyers. */
export function watermarkForced(tier: OrgPlanTier, access: PlayerAccess | null): boolean {
  return tier === "rookie" || (tier === "free" && !!access?.hasPaid);
}

/** What the pass costs per game of the team's season: "26 games · 38 kr a game". */
export function passValueLine(gamesInSeason: number): string | null {
  if (gamesInSeason <= 0) return null;
  const perGame = Math.round(PLAYER_PRICES.seasonPass / gamesInSeason);
  return `${gamesInSeason} ${gamesInSeason === 1 ? "game" : "games"} · ${perGame} kr a game`;
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
      return { label: `Free game · ${access.trialLeft} left`, tone: "free" };
    case "single":
      return { label: `Uses 1 bought game · ${access.singlesLeft} left`, tone: "bought" };
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
  if (access.trialLeft > 0) return { label: `Free game · ${access.trialLeft} left`, tone: "free" };
  if (access.singlesLeft > 0) return { label: `Uses 1 bought game · ${access.singlesLeft} left`, tone: "bought" };
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

/**
 * What the purchase sheet offers, in order. `game` is the game that hit the
 * limit (null when the sheet opens from export). Coaches see Pro first.
 * Empty while sales are off: the caller shows the old upgrade dialog.
 */
export function sheetOffers(
  game: GameAccess | null,
  access: PlayerAccess,
  role: "coach" | "player" | null,
): SheetOffer[] {
  if (!access.enabled) return [];
  const offers: SheetOffer[] = [];
  const team = access.team;
  const season = access.seasonOnSale ? seasonLabel(access.seasonOnSale) : "";

  const opensExport = access.hasPaid ? "" : " Also opens export for all your games.";
  offers.push(
    game
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
        },
  );

  const passOnOffer = game
    ? game.passAvailable
    : !!team && team.inSeasonOnSale && !activePass(access);
  if (passOnOffer && team) {
    const value = passValueLine(team.gamesInSeason);
    offers.push({
      kind: "season_pass",
      price: PLAYER_PRICES.seasonPass,
      title: `Season pass ${season}`,
      detail: [`Every ${team.name} game this season, playoffs included.`, value].filter(Boolean).join(" "),
    });
  }

  const pro: SheetOffer = {
    kind: "pro",
    price: PRO_MONTHLY_PRICE,
    title: "Pro",
    detail: "Unlimited games of any team. Billed monthly.",
  };
  return role === "coach" ? [pro, ...offers] : [...offers, pro];
}

/** Why the pass isn't offered for a game, when the player might expect it. */
export function passNotOfferedReason(game: GameAccess, access: PlayerAccess): string | null {
  if (!access.enabled || game.passAvailable) return null;
  const team = access.team;
  if (!team) return "Set your team to see the season pass.";
  if (!game.ownTeam) return `The season pass covers ${team.name} games only.`;
  if (activePass(access)) return null;
  if (!team.inSeasonOnSale) return `${team.name} has no games in the season on sale.`;
  return null;
}

/** One line for the space switcher and profile meters. */
export function playerMeterLabel(access: PlayerAccess): string {
  const pass = activePass(access);
  if (pass) return `Season pass · ${pass.teamName}`;
  const { trialLeft, trialGames, singlesLeft } = access;
  if (trialLeft > 0 && singlesLeft > 0) {
    return `${trialLeft} free and ${singlesLeft} bought ${trialLeft + singlesLeft === 1 ? "game" : "games"} left`;
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

/** "999 kr" from öre. */
export function formatKronor(ore: number): string {
  return `${Math.round(ore / 100).toLocaleString("sv-SE")} kr`;
}

/** "Season pass", "Single game", "3 single games". */
export function purchaseLabel(p: PlayerPurchase): string {
  if (p.kind === "season_pass") return "Season pass";
  return p.quantity > 1 ? `${p.quantity} single games` : "Single game";
}
