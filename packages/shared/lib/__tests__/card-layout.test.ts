import { describe, expect, it } from "vitest";
import { CARD_SIZE, layoutStatsCard, layoutTextCard, type MeasureText } from "../card-layout";
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
