/**
 * Paints a player highlight's graphics for the export (1080×1920 PNGs, base64), from the plan in
 * @scoutable/shared/lib/highlight-render:
 *   - the hook: a dark fade at the top with the player's line ("22 pts · 6 reb") and who and which game, on the
 *     first play from frame 0;
 *   - a label on every other play, like its row in the app ("Q1 05:43 ● 2PT made 13–15");
 *   - the end card: the line, the wordmark and scoutable.se.
 * Same font as the playlist cards (the bundled Roboto). The layout follows the hand-made template
 * (player-highlights/, 2026-11-27): text in the top band the platforms leave clear (y about 270–450).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { HighlightKind, } from "@scoutable/shared/lib/highlight-picks";
import type { HighlightOverlay } from "@scoutable/shared/lib/highlight-render";
import { Wordmark } from "@/components/logo";
import { FAMILY, blobToBase64, canvasToBlob, loadCardFonts } from "@/lib/card-painter";

const W = 1080;
const H = 1920;
const INK = "#e6ebef";
const MUTED = "#9aa5af";
/** The app's event colours (index.css --ev-*), for the label's dot. */
const DOT: Record<HighlightKind, string> = { dunk: "#34d399", two: "#34d399", three: "#059669", steal: "#a78bfa", block: "#7c3aed" };

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the highlight");
  return [c, ctx];
}

function font(ctx: CanvasRenderingContext2D, weight: 400 | 700, px: number) {
  ctx.font = `${weight === 700 ? "bold " : ""}${px}px "${FAMILY}"`;
}

/** Shrinks the font until the text fits `max` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: 400 | 700, px: number, max: number): number {
  let size = px;
  font(ctx, weight, size);
  while (size > 20 && ctx.measureText(text).width > max) {
    size -= 2;
    font(ctx, weight, size);
  }
  return size;
}

function paintHook(ctx: CanvasRenderingContext2D, o: Extract<HighlightOverlay, { kind: "hook" }>) {
  const fade = ctx.createLinearGradient(0, 0, 0, 700);
  fade.addColorStop(0, "rgba(5,8,11,0.78)");
  fade.addColorStop(0.55, "rgba(5,8,11,0.5)");
  fade.addColorStop(1, "rgba(5,8,11,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 12;
  ctx.fillStyle = INK;
  fit(ctx, o.line, 700, 88, 840);
  ctx.fillText(o.line, W / 2, 350);
  ctx.fillStyle = "#d7dee4";
  fit(ctx, o.who, 400, 34, 840);
  ctx.fillText(o.who, W / 2, 412);
}

function paintLabel(ctx: CanvasRenderingContext2D, o: Extract<HighlightOverlay, { kind: "label" }>) {
  const px = 36;
  const gap = 26;
  const dot = 18;
  font(ctx, 400, px);
  const clockW = ctx.measureText(o.clock).width;
  font(ctx, 700, px);
  const playW = ctx.measureText(o.play).width;
  font(ctx, 400, px);
  const scoreW = o.score ? ctx.measureText(o.score).width : 0;
  const inner = clockW + gap + dot + 14 + playW + (o.score ? gap + scoreW : 0);
  const pad = 34;
  const h = 80;
  const w = Math.min(W - 80, inner + pad * 2);
  const x = (W - w) / 2;
  const y = 300;
  ctx.fillStyle = "rgba(14,20,26,0.84)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();
  const mid = y + h / 2;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let cx = x + pad;
  font(ctx, 400, px);
  ctx.fillStyle = MUTED;
  ctx.fillText(o.clock, cx, mid + 1);
  cx += clockW + gap;
  ctx.fillStyle = DOT[o.kindOf];
  ctx.beginPath();
  ctx.arc(cx + dot / 2, mid, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  cx += dot + 14;
  font(ctx, 700, px);
  ctx.fillStyle = INK;
  ctx.fillText(o.play, cx, mid + 1);
  cx += playW + gap;
  if (o.score) {
    font(ctx, 400, px);
    ctx.fillStyle = MUTED;
    ctx.fillText(o.score, cx, mid + 1);
  }
}

/** The hook's line and who, or a play's label, over a clip (transparent elsewhere). */
export async function highlightOverlayPng(o: HighlightOverlay): Promise<string> {
  await loadCardFonts();
  const [c, ctx] = canvas();
  if (o.kind === "hook") paintHook(ctx, o);
  else paintLabel(ctx, o);
  return blobToBase64(await canvasToBlob(c));
}

/** The wordmark in the brand colours, as an image (the app's own SVG, components/logo.tsx). */
function wordmarkImage(): Promise<HTMLImageElement> {
  const svg = renderToStaticMarkup(createElement(Wordmark, {}))
    .replace('class="fill-foreground"', 'fill="#f1f5f9"')
    .replace("<svg ", '<svg width="1130" height="174" ');
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't draw the wordmark"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** The end card: a line, the wordmark, scoutable.se. */
export async function highlightEndCardPng(line: string): Promise<string> {
  await loadCardFonts();
  const [c, ctx] = canvas();
  ctx.fillStyle = "#161b24";
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  fit(ctx, line, 700, 76, 860);
  ctx.fillText(line, W / 2, 760);
  const mark = await wordmarkImage();
  const mw = 640;
  const mh = (mw * 174) / 1130;
  ctx.drawImage(mark, (W - mw) / 2, 840, mw, mh);
  ctx.fillStyle = "#b3bcc4";
  font(ctx, 400, 40);
  ctx.fillText("scoutable.se", W / 2, 1060);
  return blobToBase64(await canvasToBlob(c));
}
