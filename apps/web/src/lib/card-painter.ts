/**
 * Draws playlist cards (text and stats) on a canvas, as the desktop's painter
 * does (apps/desktop/src/lib/card-painter.ts, ported call for call): the
 * layout is shared (card-layout.ts) and the font is the bundled Roboto, so a
 * card looks the same in the desktop, here, in the server export and in the
 * players' watch view.
 *
 * Browser only: call these from effects and handlers, never while rendering
 * on the server.
 */
// Twins: public/fonts/ holds the desktop's apps/desktop/src/assets/fonts/ and
// the server export's packages/node-video/assets/fonts/, byte for byte;
// change all three together.
import {
  CARD_BACKGROUND,
  CARD_SIZE,
  layoutStatsCard,
  layoutTextCard,
  type CardAspect,
  type CardFontWeight,
  type MeasureText,
} from "@scoutable/shared/lib/card-layout";
import { cardContent } from "@scoutable/shared/lib/stats-card";
import type { PlaylistTextCard } from "@scoutable/shared/types/match";

/** What a card is drawn from: its text, or its stats spec when it has one. */
export type CardSource = Pick<PlaylistTextCard, "text" | "card">;

const FAMILY = "Scoutable Card";
const REGULAR_URL = "/fonts/Roboto-Regular.ttf";
const BOLD_URL = "/fonts/Roboto-Bold.ttf";

let fontsLoading: Promise<void> | null = null;

/** Loads the card font once; every paint waits for it. */
export function loadCardFonts(): Promise<void> {
  fontsLoading ??= Promise.all(
    [
      new FontFace(FAMILY, `url(${REGULAR_URL})`, { weight: "400" }),
      new FontFace(FAMILY, `url(${BOLD_URL})`, { weight: "700" }),
    ].map(async (face) => {
      await face.load();
      document.fonts.add(face);
    }),
  )
    .then(() => undefined)
    .catch((e: unknown) => {
      fontsLoading = null; // let the next paint try again
      throw e;
    });
  return fontsLoading;
}

function font(px: number, weight: CardFontWeight): string {
  return `${weight === "bold" ? 700 : 400} ${px}px "${FAMILY}"`;
}

/** Paints a card at its export size. Call after loadCardFonts resolves. */
export function paintCard(source: CardSource, aspect: CardAspect, canvas = document.createElement("canvas")): HTMLCanvasElement {
  const { width, height } = CARD_SIZE[aspect];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't draw the card");
  ctx.fillStyle = CARD_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const measure: MeasureText = (text, px, weight) => {
    ctx.font = font(px, weight);
    return ctx.measureText(text).width;
  };
  const runs = source.card
    ? layoutStatsCard(cardContent(source.card), aspect, measure)
    : layoutTextCard(source.text, aspect, measure);
  for (const run of runs) {
    ctx.font = font(run.px, run.weight);
    ctx.fillStyle = run.color;
    ctx.fillText(run.text, run.x, run.y);
  }
  return canvas;
}

async function paintToBlob(source: CardSource, aspect: CardAspect): Promise<Blob> {
  await loadCardFonts();
  const canvas = paintCard(source, aspect);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't draw the card"))), "image/png"),
  );
}

/** The card as an object URL for an <img>; revoke it when it's replaced. */
export async function cardObjectUrl(source: CardSource, aspect: CardAspect): Promise<string> {
  return URL.createObjectURL(await paintToBlob(source, aspect));
}
