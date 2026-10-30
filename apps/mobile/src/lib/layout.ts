/**
 * The app's spacing rhythm, in points: the measures the shell and the
 * primitives share, so every screen lines up the same way. Classes say the
 * same where a class fits (`px-4` = PAGE_X).
 */

/** Left and right margin of every screen, sheet and list. */
export const PAGE_X = 16;
/** Between sections of a screen. */
export const SECTION_GAP = 24;
/** A one-line row; also the minimum touch target. */
export const ROW_MIN_H = 44;
/** A two-line row (label + description). */
export const ROW_TWO_LINE_MIN_H = 56;
/** The title bar's row under the status bar (detail screens). */
export const TOOLBAR_ROW_H = 44;
/** A root screen's bar row: room for the 44 pt glass buttons (menu, filter). */
export const ROOT_BAR_ROW_H = 56;
/** Space under the title bar before the content starts. */
export const CONTENT_TOP = 8;
/** Space under the last row, above the tab bar or the home indicator. */
export const CONTENT_BOTTOM = 40;
/** Button heights: xs, sm, default, lg. */
export const BUTTON_H = { xs: 36, sm: 40, default: 44, lg: 48 } as const;
