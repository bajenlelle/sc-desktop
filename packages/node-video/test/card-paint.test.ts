import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { CARD_SIZE, layoutTextCard, type CardAspect, type TextRun } from "@scoutable/shared/lib/card-layout";
import { cardContent, parseCardSpec } from "@scoutable/shared/lib/stats-card";
import { CARD_FONT_FILES, WATERMARK_PNG } from "../lib/assets.ts";
import { paintCard, paintCardPng, registerCardFonts } from "../lib/card-paint.ts";

/** A game card as playlist_clips.card stores it (the shape of stats-card.test.ts's gameCard). */
const GAME_SPEC = {
  type: "stats",
  v: 1,
  source: "genius_hosted",
  scope: "game",
  player: { id: "1693025", name: "Alva Berg", number: "7", teamId: "187005", teamName: "Bajen Basket" },
  game: { matchId: "m-1", sourceGameId: "2668882", competitionId: 41539, opponent: "AIK", date: "2026-10-12", home: true, us: 84, them: 79 },
  line: { min: 31 * 60 + 2, pts: 24, fgm: 9, fga: 14, tpm: 3, tpa: 5, ftm: 3, fta: 4, oreb: 3, dreb: 7, ast: 5, stl: 1, blk: 0, tov: 2, pf: 3, pm: 12 },
  columns: ["pts", "reb", "ast", "fg"],
  heading: null,
  details: null,
  asOf: "2026-10-17T10:00:00Z",
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.equal(png.subarray(12, 16).toString("latin1"), "IHDR");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** The brightest red value in the run's cap-height band, across its measured width. */
function brightestInRun(canvas: Canvas, run: TextRun): number {
  const ctx = canvas.getContext("2d");
  ctx.font = `${run.weight === "bold" ? 700 : 400} ${run.px}px "Scoutable Card"`;
  const w = Math.ceil(ctx.measureText(run.text).width);
  const top = Math.round(run.y - 0.72 * run.px);
  const data = ctx.getImageData(Math.round(run.x - w / 2), top, w, Math.round(run.y) - top).data;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) max = Math.max(max, data[i]);
  return max;
}

for (const aspect of ["16:9", "9:16"] as CardAspect[]) {
  test(`a card is a PNG of the export's size (${aspect})`, () => {
    assert.deepEqual(pngSize(paintCardPng({ text: "Defence first", card: null }, aspect)), CARD_SIZE[aspect]);
    assert.deepEqual(pngSize(paintCardPng({ text: "", card: GAME_SPEC }, aspect)), CARD_SIZE[aspect]);
  });

  test(`a text card draws its first run in white on the black background (${aspect})`, () => {
    const { canvas, runs } = paintCard({ text: "Defence: rotate early on the weak side", card: null }, aspect);
    assert.ok(runs.length >= 1);
    assert.equal(runs[0].px, 61, "the Rust exporter's text size");
    assert.ok(brightestInRun(canvas, runs[0]) > 200, "the first run's glyphs are drawn");
    // The background stays CARD_BACKGROUND (#000000) away from the text.
    assert.deepEqual([...canvas.getContext("2d").getImageData(2, 2, 1, 1).data], [0, 0, 0, 255]);
  });
}

test("a stats card is drawn from its spec: the heading, then the numbers", () => {
  const { canvas, runs } = paintCard({ text: "Alva Berg · 24 PTS · 10 REB · 5 AST · 9/14 FG · vs AIK", card: GAME_SPEC }, "16:9");
  const content = cardContent(parseCardSpec(GAME_SPEC)!);
  assert.equal(runs[0].text, "Alva Berg");
  assert.equal(runs[0].weight, "bold");
  for (const cell of content.cells) assert.ok(runs.some((r) => r.text === cell.value && r.weight === "bold"), `value ${cell.value} drawn`);
  assert.ok(brightestInRun(canvas, runs[0]) > 200);
  const value = runs.find((r) => r.text === "24")!;
  assert.ok(brightestInRun(canvas, value) > 200);
});

test("both weights are registered under the card family: bold measures wider than regular", () => {
  registerCardFonts();
  const ctx = createCanvas(10, 10).getContext("2d");
  ctx.font = '400 60px "Scoutable Card"';
  const regular = ctx.measureText("Alva Berg 24").width;
  ctx.font = '700 60px "Scoutable Card"';
  const bold = ctx.measureText("Alva Berg 24").width;
  assert.ok(regular > 100, `regular ${regular}`);
  assert.ok(bold > regular, `bold ${bold} vs regular ${regular}`);
});

test("a spec this build can't parse leaves the card's text, as the desktop does", () => {
  const { runs } = paintCard({ text: "Alva Berg · 24 PTS", card: { type: "stats", v: 99 } }, "9:16");
  const measure = () => 0;
  assert.deepEqual(
    runs.map((r) => r.text),
    layoutTextCard("Alva Berg · 24 PTS", "9:16", measure).map((r) => r.text),
  );
  assert.equal(runs[0].px, 61);
});

test("an empty text card is a black frame", () => {
  const { canvas, runs } = paintCard({ text: "", card: null }, "16:9");
  assert.deepEqual(runs, []);
  const data = canvas.getContext("2d").getImageData(0, 0, 1280, 720).data;
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] !== 0) lit++;
  assert.equal(lit, 0);
});

test("the assets are the desktop's twins: Roboto files and the 230×36 wordmark", () => {
  assert.ok(readFileSync(CARD_FONT_FILES.regular).length > 100_000);
  assert.ok(readFileSync(CARD_FONT_FILES.bold).length > 100_000);
  assert.deepEqual(pngSize(readFileSync(WATERMARK_PNG)), { width: 230, height: 36 });
});
