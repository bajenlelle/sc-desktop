/**
 * Swedish stat-keeping grammar: turns what the speech recogniser heard
 * ("två poäng nummer nio", "retur elva", "ångra") into StatIntents.
 *
 * Closed vocabulary, deterministic, roster-aware. The parser never guesses a
 * jersey that is not on the roster and returns a failure reason instead of a
 * half-understood event — the phone shows the reason and the keeper taps.
 *
 * Pure: no platform code, no state. Tested against
 * __tests__/fixtures/stat-utterances.sv.json; grow that file from transcripts.
 */
import type {
  ParseContext,
  ParsedUtterance,
  RosterEntry,
  StatIntent,
} from "../types/stat-session";

// ---------------------------------------------------------------------------
// Numbers 0–99
// ---------------------------------------------------------------------------

const UNITS = [
  "noll", "ett", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio",
  "tio", "elva", "tolv", "tretton", "fjorton", "femton", "sexton", "sjutton", "arton", "nitton",
];
const TENS: Record<number, string> = {
  20: "tjugo", 30: "trettio", 40: "fyrtio", 50: "femtio",
  60: "sextio", 70: "sjuttio", 80: "åttio", 90: "nittio",
};
const UNIT_OF = new Map<string, number>(UNITS.map((w, i) => [w, i]));
UNIT_OF.set("en", 1);
const TENS_OF = new Map<string, number>(Object.entries(TENS).map(([n, w]) => [w, Number(n)]));

/** Things the recogniser produces for numbers that are not Swedish words. */
const HOMOPHONES: Record<string, string> = {
  nie: "nio",
  fira: "fyra",
  tolf: "tolv",
  sek: "sex",
  åta: "åtta",
  tjuge: "tjugo",
};

export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new RangeError(`numberToWords: ${n}`);
  if (n < 20) return UNITS[n];
  const tens = Math.floor(n / 10) * 10;
  const unit = n % 10;
  return unit === 0 ? TENS[tens] : `${TENS[tens]} ${UNITS[unit]}`;
}

/** One number from one or two tokens ("42", "nio", "tjugo tre", "tjugotre"); null otherwise. */
export function wordsToNumber(tokens: string[]): number | null {
  const t = tokens.map((x) => HOMOPHONES[x] ?? x);
  if (t.length === 1) {
    const w = t[0];
    if (/^\d{1,2}$/.test(w)) return Number(w);
    if (UNIT_OF.has(w)) return UNIT_OF.get(w)!;
    if (TENS_OF.has(w)) return TENS_OF.get(w)!;
    for (const [tensWord, tens] of TENS_OF) {
      if (w.startsWith(tensWord) && w.length > tensWord.length) {
        const unit = UNIT_OF.get(w.slice(tensWord.length));
        if (unit !== undefined && unit >= 1 && unit <= 9) return tens + unit;
      }
    }
    return null;
  }
  if (t.length === 2) {
    const tens = TENS_OF.get(t[0]);
    const unit = UNIT_OF.get(t[1]);
    if (tens !== undefined && unit !== undefined && unit >= 1 && unit <= 9) return tens + unit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

type EventWord =
  | "shot1" | "shot2" | "shot3" | "rebound" | "assist" | "steal" | "block"
  | "turnover" | "foul" | "foulon" | "timeout" | "undo" | "period" | "period_next"
  | "overtime" | "tipoff";
type Modifier = "miss" | "off" | "def";
type SideWord = "opponent" | "ours" | "home" | "away";

type Symbol =
  | { t: "event"; ev: EventWord; mods?: Modifier[] }
  | { t: "mod"; mod: Modifier }
  | { t: "num"; n: number; soft?: boolean } // soft: "en"/"ett", may be an article
  | { t: "ord"; n: number }
  | { t: "side"; side: SideWord }
  | { t: "filler" }
  | { t: "word"; w: string };

/** Multi-word first; keys are space-joined normalised tokens. */
const PHRASES: Array<[string, Symbol]> = [
  ["två poäng", { t: "event", ev: "shot2" }],
  ["2 poäng", { t: "event", ev: "shot2" }],
  ["två poängare", { t: "event", ev: "shot2" }],
  ["tre poäng", { t: "event", ev: "shot3" }],
  ["3 poäng", { t: "event", ev: "shot3" }],
  ["tre poängare", { t: "event", ev: "shot3" }],
  ["ett poäng", { t: "event", ev: "shot1" }],
  ["en poäng", { t: "event", ev: "shot1" }],
  ["1 poäng", { t: "event", ev: "shot1" }],
  ["tappad boll", { t: "event", ev: "turnover" }],
  ["tappar bollen", { t: "event", ev: "turnover" }],
  ["tappade bollen", { t: "event", ev: "turnover" }],
  ["foul på", { t: "event", ev: "foulon" }],
  ["fel på", { t: "event", ev: "foulon" }],
  ["foulen på", { t: "event", ev: "foulon" }],
  ["personligt fel", { t: "event", ev: "foul" }],
  ["personlig foul", { t: "event", ev: "foul" }],
  ["time out", { t: "event", ev: "timeout" }],
  ["ta bort", { t: "event", ev: "undo" }],
  ["nästa period", { t: "event", ev: "period_next" }],
  ["nästa kvart", { t: "event", ev: "period_next" }],
];

const WORDS: Record<string, Symbol> = {
  // shots
  tvåa: { t: "event", ev: "shot2" }, tvåan: { t: "event", ev: "shot2" }, tvåpoängare: { t: "event", ev: "shot2" },
  trea: { t: "event", ev: "shot3" }, trean: { t: "event", ev: "shot3" }, trepoängare: { t: "event", ev: "shot3" },
  straff: { t: "event", ev: "shot1" }, straffen: { t: "event", ev: "shot1" }, straffkast: { t: "event", ev: "shot1" },
  straffkastet: { t: "event", ev: "shot1" }, frikast: { t: "event", ev: "shot1" }, frikastet: { t: "event", ev: "shot1" },
  // made / missed
  bom: { t: "mod", mod: "miss" }, bommar: { t: "mod", mod: "miss" }, bommade: { t: "mod", mod: "miss" }, bommat: { t: "mod", mod: "miss" },
  miss: { t: "mod", mod: "miss" }, missar: { t: "mod", mod: "miss" }, missade: { t: "mod", mod: "miss" },
  missad: { t: "mod", mod: "miss" }, missat: { t: "mod", mod: "miss" },
  // rebounds
  retur: { t: "event", ev: "rebound" }, returen: { t: "event", ev: "rebound" }, returer: { t: "event", ev: "rebound" },
  rebound: { t: "event", ev: "rebound" }, rebounden: { t: "event", ev: "rebound" },
  anfallsretur: { t: "event", ev: "rebound", mods: ["off"] }, försvarsretur: { t: "event", ev: "rebound", mods: ["def"] },
  offensiv: { t: "mod", mod: "off" }, offensiva: { t: "mod", mod: "off" }, off: { t: "mod", mod: "off" }, anfall: { t: "mod", mod: "off" },
  defensiv: { t: "mod", mod: "def" }, defensiva: { t: "mod", mod: "def" }, def: { t: "mod", mod: "def" }, försvar: { t: "mod", mod: "def" },
  // assists
  assist: { t: "event", ev: "assist" }, assisten: { t: "event", ev: "assist" }, assister: { t: "event", ev: "assist" },
  // steals
  steal: { t: "event", ev: "steal" }, steals: { t: "event", ev: "steal" }, stöld: { t: "event", ev: "steal" }, stölden: { t: "event", ev: "steal" },
  snodd: { t: "event", ev: "steal" }, snor: { t: "event", ev: "steal" }, snodde: { t: "event", ev: "steal" },
  bryter: { t: "event", ev: "steal" }, bröt: { t: "event", ev: "steal" }, brytning: { t: "event", ev: "steal" },
  // blocks
  block: { t: "event", ev: "block" }, blocken: { t: "event", ev: "block" }, blockering: { t: "event", ev: "block" },
  blockad: { t: "event", ev: "block" }, blockar: { t: "event", ev: "block" }, blockerar: { t: "event", ev: "block" },
  blockade: { t: "event", ev: "block" }, blocka: { t: "event", ev: "block" },
  // turnovers
  tappad: { t: "event", ev: "turnover" }, tappar: { t: "event", ev: "turnover" }, tappade: { t: "event", ev: "turnover" },
  tappat: { t: "event", ev: "turnover" }, turnover: { t: "event", ev: "turnover" }, bolltapp: { t: "event", ev: "turnover" },
  bollförlust: { t: "event", ev: "turnover" },
  // fouls
  foul: { t: "event", ev: "foul" }, foulen: { t: "event", ev: "foul" }, fel: { t: "event", ev: "foul" }, felet: { t: "event", ev: "foul" },
  personlig: { t: "event", ev: "foul" }, personligt: { t: "event", ev: "foul" },
  // game flow
  timeout: { t: "event", ev: "timeout" }, timeouten: { t: "event", ev: "timeout" },
  ångra: { t: "event", ev: "undo" }, undo: { t: "event", ev: "undo" },
  period: { t: "event", ev: "period" }, perioden: { t: "event", ev: "period" }, kvart: { t: "event", ev: "period" },
  kvarten: { t: "event", ev: "period" }, halvlek: { t: "event", ev: "period" }, halvleken: { t: "event", ev: "period" },
  övertid: { t: "event", ev: "overtime" }, förlängning: { t: "event", ev: "overtime" },
  uppkast: { t: "event", ev: "tipoff" }, avkast: { t: "event", ev: "tipoff" }, tipoff: { t: "event", ev: "tipoff" }, matchstart: { t: "event", ev: "tipoff" },
  // ordinals (periods)
  första: { t: "ord", n: 1 }, andra: { t: "ord", n: 2 }, tredje: { t: "ord", n: 3 }, fjärde: { t: "ord", n: 4 }, femte: { t: "ord", n: 5 },
  // sides
  dom: { t: "side", side: "opponent" }, de: { t: "side", side: "opponent" }, dem: { t: "side", side: "opponent" },
  deras: { t: "side", side: "opponent" }, motståndarna: { t: "side", side: "opponent" }, motståndare: { t: "side", side: "opponent" },
  motståndaren: { t: "side", side: "opponent" },
  vi: { t: "side", side: "ours" }, våra: { t: "side", side: "ours" }, vår: { t: "side", side: "ours" }, oss: { t: "side", side: "ours" },
  borta: { t: "side", side: "away" }, bortalaget: { t: "side", side: "away" },
  hemma: { t: "side", side: "home" }, hemmalaget: { t: "side", side: "home" },
  // fillers
  nummer: { t: "filler" }, nr: { t: "filler" }, spelare: { t: "filler" }, tack: { t: "filler" },
  eh: { t: "filler" }, öh: { t: "filler" }, ehm: { t: "filler" }, och: { t: "filler" }, för: { t: "filler" },
  av: { t: "filler" }, det: { t: "filler" }, den: { t: "filler" }, bollen: { t: "filler" }, boll: { t: "filler" },
  poäng: { t: "filler" }, på: { t: "filler" }, med: { t: "filler" }, från: { t: "filler" }, till: { t: "filler" },
};

/** Words in club names that say nothing about which club it is. */
const GENERIC_NAME_WORDS = new Set([
  "basket", "basketboll", "basketbollklubb", "bk", "bbk", "ik", "if", "sk", "fk", "ff", "bc", "bbc",
  "club", "klubb", "team", "lag", "herr", "dam", "pojkar", "flickor", "u13", "u14", "u15", "u16", "u17", "u19", "u20",
]);

function nameTokens(name: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const w of (name ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 3 && !GENERIC_NAME_WORDS.has(w)) out.add(w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tokenising and symbolising
// ---------------------------------------------------------------------------

export function normalizeUtterance(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\b2:a\b/g, "tvåa")
    .replace(/\b3:a\b/g, "trea")
    .replace(/(\p{L}|\p{N})-(\p{L}|\p{N})/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => HOMOPHONES[w] ?? w);
}

function symbolize(tokens: string[], ctx: ParseContext): Array<{ sym: Symbol; raw: string }> {
  const opp = nameTokens(ctx.opponentName);
  const ours = nameTokens(ctx.ourName);
  const out: Array<{ sym: Symbol; raw: string }> = [];
  let i = 0;
  while (i < tokens.length) {
    // longest phrase first
    let matched = false;
    for (const len of [3, 2]) {
      if (i + len > tokens.length) continue;
      const key = tokens.slice(i, i + len).join(" ");
      const hit = PHRASES.find(([p]) => p === key);
      if (hit) {
        out.push({ sym: hit[1], raw: key });
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const w = tokens[i];
    // tens + unit as two tokens ("tjugo tre")
    if (TENS_OF.has(w) && i + 1 < tokens.length) {
      const n = wordsToNumber([w, tokens[i + 1]]);
      if (n !== null) {
        out.push({ sym: { t: "num", n }, raw: `${w} ${tokens[i + 1]}` });
        i += 2;
        continue;
      }
    }
    const n = wordsToNumber([w]);
    if (n !== null) {
      out.push({ sym: { t: "num", n, soft: w === "en" || w === "ett" }, raw: w });
    } else if (WORDS[w]) {
      out.push({ sym: WORDS[w], raw: w });
    } else if (opp.has(w)) {
      out.push({ sym: { t: "side", side: "opponent" }, raw: w });
    } else if (ours.has(w)) {
      out.push({ sym: { t: "side", side: "ours" }, raw: w });
    } else {
      out.push({ sym: { t: "word", w }, raw: w });
    }
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clauses → intents
// ---------------------------------------------------------------------------

interface Clause {
  ev: EventWord | null;
  mods: Modifier[];
  nums: Array<{ n: number; soft: boolean }>;
  ord: number | null;
  words: string[];
}

function newClause(): Clause {
  return { ev: null, mods: [], nums: [], ord: null, words: [] };
}

function rosterNumbers(roster: RosterEntry[]): number[] {
  return roster.map((r) => Number(r.jerseyNumber)).filter((n) => Number.isInteger(n));
}

/** Jersey of the single roster player whose first or last name is `word`; null if none; "ambiguous" if several. */
function jerseyByName(word: string, roster: RosterEntry[]): number | null | "ambiguous" {
  const hits = new Set<number>();
  for (const r of roster) {
    const parts = r.playerName.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.includes(word)) {
      const n = Number(r.jerseyNumber);
      if (Number.isInteger(n)) hits.add(n);
    }
  }
  if (hits.size === 0) return null;
  if (hits.size > 1) return "ambiguous";
  return [...hits][0];
}

function nearest(n: number, pool: number[]): number | undefined {
  let best: number | undefined;
  for (const p of pool) {
    if (best === undefined || Math.abs(p - n) < Math.abs(best - n) || (Math.abs(p - n) === Math.abs(best - n) && p < best)) {
      best = p;
    }
  }
  return best;
}

export function parseStatUtterance(text: string, ctx: ParseContext): ParsedUtterance {
  const tokens = normalizeUtterance(text);
  if (tokens.length === 0) return { ok: false, reason: "empty", unconsumed: [] };

  const symbols = symbolize(tokens, ctx);

  // Side: first team word wins; hemma/borta are absolute.
  let side: "ours" | "opponent" = "ours";
  let sideSeen = false;
  for (const { sym } of symbols) {
    if (sym.t !== "side" || sideSeen) continue;
    sideSeen = true;
    if (sym.side === "opponent") side = "opponent";
    else if (sym.side === "ours") side = "ours";
    else if (sym.side === "home") side = ctx.ourSide === 1 ? "ours" : "opponent";
    else side = ctx.ourSide === 2 ? "ours" : "opponent";
  }

  // Clauses: a new one starts at every event word; numbers and modifiers
  // attach to the clause they are in ("nio tvåa" and "tvåa nio" both work).
  const clauses: Clause[] = [newClause()];
  const unconsumed: string[] = [];
  for (const { sym, raw } of symbols) {
    const cur = clauses[clauses.length - 1];
    switch (sym.t) {
      case "event":
        if (cur.ev !== null) clauses.push(newClause());
        clauses[clauses.length - 1].ev = sym.ev;
        if (sym.mods) clauses[clauses.length - 1].mods.push(...sym.mods);
        break;
      case "mod": cur.mods.push(sym.mod); break;
      case "num": cur.nums.push({ n: sym.n, soft: !!sym.soft }); break;
      case "ord": cur.ord = sym.n; break;
      case "side": case "filler": break;
      case "word": cur.words.push(raw); break;
    }
  }

  const hasEvent = clauses.some((c) => c.ev !== null);
  if (!hasEvent) {
    const numCount = clauses.reduce((n, c) => n + c.nums.filter((x) => !x.soft).length, 0);
    return { ok: false, reason: numCount >= 2 ? "ambiguous" : "no_event", unconsumed: collectWords(clauses) };
  }
  if (side === "opponent" && !ctx.trackBoth) {
    return { ok: false, reason: "opponent_disabled", unconsumed: collectWords(clauses) };
  }

  const roster = side === "ours" ? ctx.roster : (ctx.opponentRoster ?? []);
  const pool = rosterNumbers(roster);
  const intents: StatIntent[] = [];

  for (const c of clauses) {
    if (c.ev === null) {
      unconsumed.push(...c.words);
      continue;
    }
    // Numbers: "en"/"ett" is usually an article unless it is the only number and #1 plays.
    let nums = c.nums.filter((x) => !x.soft).map((x) => x.n);
    if (nums.length === 0 && c.nums.some((x) => x.soft) && pool.includes(1)) nums = [1];

    // Player names fill in a missing number.
    for (const w of c.words) {
      const byName = jerseyByName(w, roster);
      if (byName === "ambiguous") return { ok: false, reason: "ambiguous", unconsumed: [] };
      if (byName !== null && nums.length === 0) nums = [byName];
      else unconsumed.push(w);
    }

    const needsJersey = !["timeout", "undo", "tipoff", "period", "period_next", "overtime"].includes(c.ev);
    if (needsJersey && nums.length > 1) return { ok: false, reason: "two_numbers", unconsumed };

    let jersey: number | null = null;
    if (needsJersey && nums.length === 1) {
      jersey = nums[0];
      if (pool.length > 0 && !pool.includes(jersey)) {
        return { ok: false, reason: "unknown_jersey", jersey, suggestion: nearest(jersey, pool), unconsumed };
      }
    }

    const miss = c.mods.includes("miss");
    switch (c.ev) {
      case "shot1": intents.push({ kind: "shot", points: 1, made: !miss, jersey }); break;
      case "shot2": intents.push({ kind: "shot", points: 2, made: !miss, jersey }); break;
      case "shot3": intents.push({ kind: "shot", points: 3, made: !miss, jersey }); break;
      case "rebound": intents.push({ kind: "rebound", offensive: c.mods.includes("off"), jersey }); break;
      case "assist": intents.push({ kind: "assist", jersey }); break;
      case "steal": intents.push({ kind: "steal", jersey }); break;
      case "block": intents.push({ kind: "block", jersey }); break;
      case "turnover": intents.push({ kind: "turnover", jersey }); break;
      case "foul": intents.push({ kind: "foul", jersey }); break;
      case "foulon": intents.push({ kind: "foulon", jersey }); break;
      case "timeout": intents.push({ kind: "timeout" }); break;
      case "undo": intents.push({ kind: "undo" }); break;
      case "tipoff": intents.push({ kind: "tipoff" }); break;
      case "period_next": intents.push({ kind: "period", period: null }); break;
      case "overtime": intents.push({ kind: "period", period: 5 }); break;
      case "period": {
        const p = c.ord ?? (nums.length === 1 ? nums[0] : null);
        intents.push({ kind: "period", period: p });
        break;
      }
    }
  }

  return { ok: true, intents, side, unconsumed };
}

function collectWords(clauses: Clause[]): string[] {
  return clauses.flatMap((c) => c.words);
}

// ---------------------------------------------------------------------------
// Recogniser bias list
// ---------------------------------------------------------------------------

const CORE_VOCABULARY = [
  "tvåa", "trea", "två poäng", "tre poäng", "straff", "bom", "miss", "retur", "offensiv", "defensiv",
  "assist", "steal", "block", "tappad boll", "foul", "foul på", "timeout", "ångra", "ta bort",
  "period", "nästa period", "nummer", "poäng", "dom", "hemma", "borta", "uppkast",
];

/**
 * Phrases to bias the recogniser towards (iOS `contextualStrings`): the
 * roster's numbers as digits and words, player names, the opponent, and the
 * command vocabulary. Capped at 100 — Apple's soft ceiling — with roster
 * entries first because those are what a generic model gets wrong.
 */
export function contextualStringsFor(roster: RosterEntry[], opponentName?: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  for (const r of roster) {
    const n = Number(r.jerseyNumber);
    if (Number.isInteger(n) && n >= 0 && n <= 99) {
      push(String(n));
      push(numberToWords(n).replace(" ", ""));
    }
    for (const part of r.playerName.split(/\s+/)) push(part);
  }
  if (opponentName) for (const part of opponentName.split(/\s+/)) push(part);
  for (const w of CORE_VOCABULARY) push(w);
  return out.slice(0, 100);
}
