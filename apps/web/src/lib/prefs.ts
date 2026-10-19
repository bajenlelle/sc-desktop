/**
 * Small localStorage-backed preferences (web twin of desktop's lib/prefs.ts).
 *
 * Color-theme slots — one remembered theme id per light/dark mode, so mode
 * changes swap between the user's two picks. Keys are shared verbatim with
 * desktop, and the anti-flash boot script inlined in app/layout.tsx reads
 * the same literals: rename them everywhere or not at all. Validation
 * against the registry happens in ColorThemeProvider.
 */

const THEME_SLOT_KEYS = {
  dark: "scoutable_theme_dark",
  light: "scoutable_theme_light",
} as const;

export function getColorThemeSlot(mode: "dark" | "light"): string | null {
  try {
    return localStorage.getItem(THEME_SLOT_KEYS[mode]);
  } catch {
    return null;
  }
}

export function setColorThemeSlot(mode: "dark" | "light", themeId: string): void {
  try {
    localStorage.setItem(THEME_SLOT_KEYS[mode], themeId);
  } catch {
    // Storage unavailable (private mode etc.) — theme still applies for the session.
  }
}

/** The playlist editor's arrangement on wide windows: the list beside the player, or the player across the top. */
export type EditorLayoutPref = "split" | "theater";

const EDITOR_LAYOUT_KEY = "scoutable_editor_layout";

export function getEditorLayout(): EditorLayoutPref {
  try {
    return localStorage.getItem(EDITOR_LAYOUT_KEY) === "theater" ? "theater" : "split";
  } catch {
    return "split";
  }
}

export function setEditorLayout(layout: EditorLayoutPref): void {
  try {
    localStorage.setItem(EDITOR_LAYOUT_KEY, layout);
  } catch {
    // Remembering the arrangement is a convenience.
  }
}

/** An export's shape: the full frame, or the vertical window for phones. */
export type ExportFormat = "16:9" | "9:16";

/** The desktop's key: the format last picked in the export dialog, shown as a hint. */
const LAST_EXPORT_FORMAT_KEY = "scoutable_last_export_format";
/** The desktop's key: "1" when a Pro or Franchise user turned the mark off on downloads. */
const EXPORT_WATERMARK_OFF_KEY = "scoutable_export_watermark_off";

export function getLastExportFormat(): ExportFormat | null {
  try {
    const v = localStorage.getItem(LAST_EXPORT_FORMAT_KEY);
    return v === "16:9" || v === "9:16" ? v : null;
  } catch {
    return null;
  }
}

export function setLastExportFormat(format: ExportFormat): void {
  try {
    localStorage.setItem(LAST_EXPORT_FORMAT_KEY, format);
  } catch {
    // A hint, nothing more.
  }
}

/** Whether downloads leave the Scoutable mark off; only Pro and Franchise may, and links always carry it. */
export function getExportWatermarkDisabled(): boolean {
  try {
    return localStorage.getItem(EXPORT_WATERMARK_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setExportWatermarkDisabled(disabled: boolean): void {
  try {
    if (disabled) localStorage.setItem(EXPORT_WATERMARK_OFF_KEY, "1");
    else localStorage.removeItem(EXPORT_WATERMARK_OFF_KEY);
  } catch {
    // The switch still applies to this export.
  }
}
