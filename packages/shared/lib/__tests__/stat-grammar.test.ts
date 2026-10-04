import { describe, expect, it } from "vitest";
import type { ParseContext, RosterEntry, StatIntent } from "../../types/stat-session";
import {
  contextualStringsFor,
  numberToWords,
  parseStatUtterance,
  wordsToNumber,
} from "../stat-grammar";
import corpus from "./fixtures/stat-utterances.sv.json";

const DEFAULT_ROSTER: RosterEntry[] = ["4", "5", "7", "9", "11", "12", "15", "23", "0"].map((n) => ({
  jerseyNumber: n,
  playerName: "",
}));

type Case = {
  utterance: string;
  roster?: Array<string | [string, string]>;
  trackBoth?: boolean;
  ourSide?: 1 | 2;
  opponentName?: string;
  side?: "ours" | "opponent";
  expect: StatIntent[] | { fail: string; jersey?: number; suggestion?: number };
};

function rosterOf(spec: Case["roster"]): RosterEntry[] {
  if (spec === undefined) return DEFAULT_ROSTER;
  return spec.map((r) =>
    typeof r === "string" ? { jerseyNumber: r, playerName: "" } : { jerseyNumber: r[0], playerName: r[1] },
  );
}

function ctxOf(c: Case): ParseContext {
  return {
    roster: rosterOf(c.roster),
    trackBoth: c.trackBoth ?? false,
    ourSide: c.ourSide ?? 1,
    ourName: "Fryshuset",
    opponentName: c.opponentName,
  };
}

describe("parseStatUtterance — Swedish corpus", () => {
  for (const c of (corpus as { cases: Case[] }).cases) {
    it(JSON.stringify(c.utterance) + (c.trackBoth ? " (both teams)" : ""), () => {
      const r = parseStatUtterance(c.utterance, ctxOf(c));
      if (Array.isArray(c.expect)) {
        expect(r.ok, `expected ok, got ${JSON.stringify(r)}`).toBe(true);
        if (!r.ok) return;
        expect(r.intents).toEqual(c.expect);
        expect(r.side).toBe(c.side ?? "ours");
      } else {
        expect(r.ok, `expected failure ${c.expect.fail}, got ${JSON.stringify(r)}`).toBe(false);
        if (r.ok) return;
        expect(r.reason).toBe(c.expect.fail);
        if (c.expect.jersey !== undefined) expect(r.jersey).toBe(c.expect.jersey);
        if (c.expect.suggestion !== undefined) expect(r.suggestion).toBe(c.expect.suggestion);
      }
    });
  }

  it("reports tokens it did not understand without failing the utterance", () => {
    const r = parseStatUtterance("tvåa nio helt galet skott", ctxOf({ utterance: "", expect: [] }));
    expect(r.ok).toBe(true);
    expect(r.unconsumed).toEqual(["helt", "galet", "skott"]);
  });

  it("never guesses a jersey that is not on the roster", () => {
    const r = parseStatUtterance("tvåa fjorton", ctxOf({ utterance: "", expect: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_jersey");
  });

  it("accepts any jersey for the opponent when no opponent roster is given", () => {
    const r = parseStatUtterance("dom tvåa fjorton", {
      ...ctxOf({ utterance: "", expect: [] }),
      trackBoth: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intents).toEqual([{ kind: "shot", points: 2, made: true, jersey: 14 }]);
  });

  it("validates the opponent's jersey against the opponent roster when one is given", () => {
    const r = parseStatUtterance("dom tvåa fjorton", {
      ...ctxOf({ utterance: "", expect: [] }),
      trackBoth: true,
      opponentRoster: [{ jerseyNumber: "4", playerName: "" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_jersey");
  });
});

describe("Swedish numbers", () => {
  it("round-trips 0–99 through words and back, both compound spellings", () => {
    for (let n = 0; n <= 99; n++) {
      const words = numberToWords(n);
      expect(wordsToNumber(words.split(" ")), words).toBe(n);
      expect(wordsToNumber([words.replace(" ", "")]), words.replace(" ", "")).toBe(n);
    }
  });

  it("reads digits and rejects non-numbers", () => {
    expect(wordsToNumber(["42"])).toBe(42);
    expect(wordsToNumber(["retur"])).toBeNull();
    expect(wordsToNumber(["hundra"])).toBeNull();
  });
});

describe("contextualStringsFor", () => {
  it("lists roster numbers as digits and words, player names and the command vocabulary", () => {
    const strings = contextualStringsFor(
      [
        { jerseyNumber: "9", playerName: "Elsa Svensson" },
        { jerseyNumber: "23", playerName: "" },
      ],
      "Örebro",
    );
    expect(strings).toContain("nio");
    expect(strings).toContain("9");
    expect(strings).toContain("tjugotre");
    expect(strings).toContain("Elsa");
    expect(strings).toContain("Svensson");
    expect(strings).toContain("Örebro");
    expect(strings).toContain("retur");
    expect(strings).toContain("ångra");
    expect(strings.length).toBeLessThanOrEqual(100);
    expect(new Set(strings).size).toBe(strings.length);
  });
});
