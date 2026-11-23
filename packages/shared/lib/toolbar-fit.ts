/**
 * How much of a toolbar shows, decided by whether its title can show whole: the title (where you are) is the
 * last thing to give way. Level 0 is the full bar; level 1 drops its actions' labels (icons only, the labels as
 * tooltips); level 2 drops what is left that can go (a subtitle, a control's prefix). Apple's toolbars keep the
 * title and the primary action as the window narrows and let the rest give way; this decides when.
 *
 * The toolbar measures itself and asks `nextToolbarFit` (through `settleToolbarFit`) after every change. A step
 * up is taken from the measures alone; a step down needs an estimate of the level above, which isn't on screen:
 * what is beside the title now, plus what the step up saved (measured on either side of it), plus the title,
 * with `FIT_HYSTERESIS` to spare so a width at the edge doesn't flip the bar back and forth.
 */

export const FIT_HYSTERESIS = 32;

export type ToolbarFitLevel = 0 | 1 | 2;

export interface ToolbarFit {
  level: ToolbarFitLevel;
  /** What each step up freed beside the title: [0] level 1 against level 0, [1] level 2 against level 1. */
  savings: readonly [number, number];
  /** Just after a step up: what was beside the title at the level left, until the new level's first measure. */
  leftOther: number | null;
}

export interface ToolbarMeasure {
  /** The bar's own width. */
  headerWidth: number;
  /** Everything beside the title, at their natural widths: padding, gaps and the items before and after it. */
  other: number;
  /** The title's natural width, whole. */
  titleWidth: number;
}

export const INITIAL_TOOLBAR_FIT: ToolbarFit = { level: 0, savings: [0, 0], leftOther: null };

/** The fit after one measure: the same object when nothing changes. */
export function nextToolbarFit(fit: ToolbarFit, m: ToolbarMeasure, maxLevel: ToolbarFitLevel = 2): ToolbarFit {
  let current = fit;
  // The first measure after a step up says what the step saved.
  if (fit.leftOther !== null && fit.level > 0) {
    const savings: [number, number] = [fit.savings[0], fit.savings[1]];
    savings[fit.level - 1] = Math.max(0, fit.leftOther - m.other);
    current = { level: fit.level, savings, leftOther: null };
  }
  if (m.headerWidth < m.other + m.titleWidth && current.level < maxLevel) {
    return { level: (current.level + 1) as ToolbarFitLevel, savings: current.savings, leftOther: m.other };
  }
  if (current.level > 0) {
    const above = m.other + current.savings[current.level - 1];
    if (m.headerWidth >= above + m.titleWidth + FIT_HYSTERESIS) {
      return { level: (current.level - 1) as ToolbarFitLevel, savings: current.savings, leftOther: null };
    }
  }
  return current;
}

/**
 * Steps until the fit holds: after each step the bar is drawn at its new level and measured again (`measure`
 * renders it, as the toolbar does with flushSync). An estimate that was off costs one step down and one back up,
 * never a loop: the step back up records the saving as it now is.
 */
export function settleToolbarFit(
  fit: ToolbarFit,
  measure: (fit: ToolbarFit) => ToolbarMeasure,
  maxLevel: ToolbarFitLevel = 2,
): ToolbarFit {
  let current = fit;
  for (let i = 0; i < 6; i++) {
    const next = nextToolbarFit(current, measure(current), maxLevel);
    if (next === current) break;
    current = next;
  }
  return current;
}
