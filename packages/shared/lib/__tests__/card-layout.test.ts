import { describe, expect, it } from "vitest";
import { CARD_SIZE, layoutStatsCard, layoutTextCard, wrapWords, type MeasureText } from "../card-layout";
import type { CardContent } from "../stats-card";

/** Roughly Roboto: half an em per character, bold a little wider. */
const measure: MeasureText = (text, px, weight) => text.length * px * (weight === "bold" ? 0.58 : 0.52);

const content = (cells: number, heading = "Alva Berg"): CardContent => ({
  heading,
  details: "#7 · Bajen Basket",
  context: "vs AIK · 12 Oct 2026 · W 84–79",
  cells: ["24", "10", "5", "9/14", "3/5", "+12"].slice(0, cells).map((value, i) => ({
    value,
    label: ["PTS", "REB", "AST", "FG", "3P", "+/−"][i],
  })),
});

const NOTE = "Great closeouts all game and smart help from the weak side, keep talking on every switch and box out early";

function inFrame(aspect: "16:9" | "9:16", runs: ReturnType<typeof layoutStatsCard>) {
  const { width } = CARD_SIZE[aspect];
  for (const r of runs) {
    const half = measure(r.text, r.px, r.weight) / 2;
    expect(r.x - half).toBeGreaterThanOrEqual(0);
    expect(r.x + half).toBeLessThanOrEqual(width);
  }
}

describe("layoutStatsCard", () => {
  it("keeps widescreen content above the watermark band (y 636)", () => {
    const runs = layoutStatsCard(content(6), "16:9", measure);
    expect(runs).toHaveLength(3 + 6 * 2);
    expect(Math.max(...runs.map((r) => r.y))).toBeLessThan(600);
    expect(Math.min(...runs.map((r) => r.y - r.px))).toBeGreaterThan(60);
    inFrame("16:9", runs);
  });

  it("lays six cells out in one widescreen row, left to right", () => {
    const values = layoutStatsCard(content(6), "16:9", measure).filter((r) => r.px >= 48 && r.weight === "bold").slice(1);
    expect(new Set(values.map((r) => r.y)).size).toBe(1);
    expect(values.map((r) => r.text)).toEqual(["24", "10", "5", "9/14", "3/5", "+12"]);
    expect(values.map((r) => r.x)).toEqual([...values.map((r) => r.x)].sort((a, b) => a - b));
  });

  it("stacks vertical cells three to a row and stays clear of the bottom third", () => {
    const runs = layoutStatsCard(content(5), "9:16", measure);
    const valueRows = new Set(runs.filter((r) => r.weight === "bold" && r.text !== "Alva Berg").map((r) => r.y));
    expect(valueRows.size).toBe(2);
    expect(Math.max(...runs.map((r) => r.y))).toBeLessThan(1140);
    expect(Math.min(...runs.map((r) => r.y - r.px))).toBeGreaterThan(240);
    inFrame("9:16", runs);
  });

  it("splits four vertical cells two and two", () => {
    const runs = layoutStatsCard(content(4), "9:16", measure);
    const values = runs.filter((r) => r.weight === "bold" && r.text !== "Alva Berg");
    const rows = [...new Set(values.map((r) => r.y))];
    expect(rows).toHaveLength(2);
    expect(values.filter((r) => r.y === rows[0])).toHaveLength(2);
  });

  it("keeps a clear gap between neighbouring numbers, however long they are", () => {
    const decimals: CardContent = {
      ...content(0),
      cells: ["11.8", "37.6", "82.1", "100.0", "+12.5", "1.8"].map((value, i) => ({ value, label: ["PTS", "3P%", "FT%", "FG%", "+/\u2212", "STL"][i] })),
    };
    for (const aspect of ["16:9", "9:16"] as const) {
      for (const count of [3, 6]) {
        const runs = layoutStatsCard({ ...decimals, cells: decimals.cells.slice(0, count) }, aspect, measure);
        const values = runs.filter((r) => r.weight === "bold" && r.text !== decimals.heading);
        for (const row of new Set(values.map((r) => r.y))) {
          const inRow = values.filter((r) => r.y === row).sort((a, b) => a.x - b.x);
          for (let i = 1; i < inRow.length; i++) {
            const prevRight = inRow[i - 1].x + measure(inRow[i - 1].text, inRow[i - 1].px, "bold") / 2;
            const left = inRow[i].x - measure(inRow[i].text, inRow[i].px, "bold") / 2;
            expect(left - prevRight).toBeGreaterThanOrEqual(40);
          }
        }
        inFrame(aspect, runs);
      }
    }
  });

  it("lines up the columns of a full vertical grid", () => {
    const runs = layoutStatsCard(content(6), "9:16", measure);
    const values = runs.filter((r) => r.weight === "bold" && r.text !== "Alva Berg");
    const [top, bottom] = [...new Set(values.map((r) => r.y))];
    expect(values.filter((r) => r.y === top).map((r) => r.x)).toEqual(values.filter((r) => r.y === bottom).map((r) => r.x));
  });

  it("shrinks a long name to fit instead of overflowing", () => {
    const long = "Aleksandar Konstantinović-Westerberg Johansson";
    const [heading] = layoutStatsCard(content(3, long), "16:9", measure);
    expect(heading.px).toBeLessThan(60);
    inFrame("16:9", [heading]);
  });

  it("centres a card with no stats chosen", () => {
    const runs = layoutStatsCard(content(0), "16:9", measure);
    expect(runs).toHaveLength(3);
    const mid = (runs[0].y - runs[0].px * 0.72 + runs[2].y) / 2;
    expect(Math.abs(mid - 330)).toBeLessThan(2);
  });

  it("wraps a note under the cells, inside the band", () => {
    for (const [aspect, bottom, max] of [["16:9", 600, 28], ["9:16", 1140, 38]] as const) {
      const runs = layoutStatsCard({ ...content(6), note: NOTE }, aspect, measure);
      const note = runs.slice(3 + 12);
      expect(note.length).toBeGreaterThanOrEqual(2);
      expect(note.length).toBeLessThanOrEqual(3);
      expect(note.every((r) => r.weight === "regular" && r.px <= max)).toBe(true);
      expect(Math.min(...note.map((r) => r.y))).toBeGreaterThan(Math.max(...runs.slice(0, 15).map((r) => r.y)));
      expect(Math.max(...runs.map((r) => r.y))).toBeLessThan(bottom);
      inFrame(aspect, runs);
    }
  });

  it("shrinks a long note to three lines and ends it with an ellipsis", () => {
    const runs = layoutStatsCard({ ...content(6), note: `${NOTE} ${NOTE} ${NOTE}` }, "9:16", measure);
    const note = runs.slice(3 + 12);
    expect(note).toHaveLength(3);
    expect(note[2].text.endsWith("…")).toBe(true);
    expect(note[0].px).toBeGreaterThanOrEqual(30);
    inFrame("9:16", runs);
  });

  it("cuts a word wider than the card", () => {
    const runs = layoutStatsCard({ ...content(3), note: "x".repeat(140) }, "16:9", measure);
    inFrame("16:9", runs);
  });

  it("keeps a note's own line breaks: two lines on two baselines, in both aspects", () => {
    for (const aspect of ["16:9", "9:16"] as const) {
      const runs = layoutStatsCard({ ...content(6), note: "Box out early\nTalk on every switch" }, aspect, measure);
      const note = runs.slice(3 + 12);
      expect(note.map((r) => r.text)).toEqual(["Box out early", "Talk on every switch"]);
      expect(note[1].y).toBeGreaterThan(note[0].y);
      expect(note[0].px).toBe(note[1].px);
      inFrame(aspect, runs);
    }
  });

  it("wraps each line of a note on its own", () => {
    const runs = layoutStatsCard({ ...content(6), note: `${NOTE}\nBox out early` }, "16:9", measure);
    const note = runs.slice(3 + 12);
    const px = note[0].px;
    expect(note.map((r) => r.text)).toEqual([...wrapWords(NOTE, (l) => measure(l, px, "regular"), 1280 - 2 * 96), "Box out early"]);
    expect(note).toHaveLength(3);
  });

  it("keeps one empty line between two paragraphs, as a gap and not a run", () => {
    const runs = layoutStatsCard({ ...content(6), note: "Box out early\n\n\nTalk on every switch" }, "16:9", measure);
    const note = runs.slice(3 + 12);
    expect(note.map((r) => r.text)).toEqual(["Box out early", "Talk on every switch"]);
    expect(note[1].y - note[0].y).toBe(2 * Math.round(note[0].px * 1.3));
  });

  it("never ends a cut note on a bare ellipsis line", () => {
    const runs = layoutStatsCard({ ...content(6), note: `${NOTE}\n\nBox out early` }, "16:9", measure);
    const note = runs.slice(3 + 12);
    expect(note).toHaveLength(2);
    expect(note[1].text.endsWith("…")).toBe(true);
    expect(note[1].text.length).toBeGreaterThan(1);
  });

  it("shows the first lines and an ellipsis when a note has more line breaks than fit", () => {
    for (const aspect of ["16:9", "9:16"] as const) {
      const runs = layoutStatsCard({ ...content(6), note: "One\nTwo\nThree\nFour\nFive" }, aspect, measure);
      const note = runs.slice(3 + 12);
      expect(note.map((r) => r.text)).toEqual(["One", "Two", "Three…"]);
      inFrame(aspect, runs);
    }
  });
});

describe("layoutTextCard", () => {
  it("wraps long text inside the side margins and centres the block", () => {
    const text = "Highlights from the season opener against AIK in Solnahallen, October 2026";
    const runs = layoutTextCard(text, "16:9", measure);
    expect(runs.length).toBeGreaterThan(1);
    for (const r of runs) expect(measure(r.text, r.px, r.weight)).toBeLessThanOrEqual(1280 - 80);
    expect(runs.map((r) => r.text).join(" ")).toBe(text);
    const top = runs[0].y - runs[0].px * 0.72;
    const bottom = runs[runs.length - 1].y;
    expect(Math.abs((top + bottom) / 2 - 360)).toBeLessThan(2);
  });

  it("draws nothing for an empty card", () => {
    expect(layoutTextCard("   ", "9:16", measure)).toEqual([]);
  });
});

describe("wrapWords", () => {
  const width = (s: string) => s.length * 10;

  it("wraps greedily at the width", () => {
    expect(wrapWords("aa bb cc", width, 50)).toEqual(["aa bb", "cc"]);
  });

  it("leaves an over-wide word alone on its line", () => {
    expect(wrapWords("short averyveryverylongword end", width, 100)).toEqual(["short", "averyveryverylongword", "end"]);
  });

  it("is empty for blank text", () => {
    expect(wrapWords("   ", width, 100)).toEqual([]);
  });
});
