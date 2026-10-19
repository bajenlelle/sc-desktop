/**
 * The files the server export draws with, twins of the desktop's (see
 * assets/README.md). Paths only, so a program can name them without loading
 * the canvas (the renderer loads card-paint.ts only when an export has a card).
 */
import { fileURLToPath } from "node:url";

const asset = (path: string) => fileURLToPath(new URL(`../assets/${path}`, import.meta.url));

/** The card font, "Scoutable Card": twins of apps/desktop/src/assets/fonts. */
export const CARD_FONT_FILES = {
  regular: asset("fonts/Roboto-Regular.ttf"),
  bold: asset("fonts/Roboto-Bold.ttf"),
} as const;

/** The wordmark the export's last pass overlays: a twin of apps/desktop/src-tauri/resources/watermark.png (230×36). */
export const WATERMARK_PNG = asset("watermark.png");
