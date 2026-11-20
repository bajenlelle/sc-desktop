import type { ReactNode } from "react";
import { BASKET_FROM_BASELINE_M, COURT_LENGTH_M, COURT_WIDTH_M } from "@scoutable/shared/lib/game-shots";

/** Half a FIBA court in metres, basket at the top: 15 wide, 14 deep. */
const W = COURT_WIDTH_M;
const H = COURT_LENGTH_M / 2;
const MID = W / 2;
const KEY_W = 4.9;
const KEY_D = 5.8;
const FT_R = 1.8;
const THREE_R = 6.75;
const THREE_SIDE = 0.9;
/** Where the three-point line's straight part meets its arc, from the baseline. */
const THREE_STRAIGHT = BASKET_FROM_BASELINE_M + Math.sqrt(THREE_R ** 2 - (MID - THREE_SIDE) ** 2);
const NO_CHARGE_R = 1.25;

/** A shot's place on the drawing, in percent of its width and height, from the feed's folded x, y. */
export function courtPercent(x: number, y: number): { left: number; top: number } {
  return { left: y, top: (x / 50) * 100 };
}

/**
 * The half court the shots are drawn on: FIBA's lines in the separator's
 * colour, scaled to its box. The dots are laid over it as buttons
 * (`children`), placed with courtPercent.
 */
export function HalfCourt({ children, label }: { children?: ReactNode; label: string }) {
  return (
    <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }} role="group" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 size-full" aria-hidden>
        <g fill="none" strokeWidth="0.05" style={{ stroke: "var(--separator-strong)" }}>
          <rect x={0} y={0} width={W} height={H} />
          <rect x={MID - KEY_W / 2} y={0} width={KEY_W} height={KEY_D} />
          <path d={`M${MID - FT_R} ${KEY_D} A${FT_R} ${FT_R} 0 0 0 ${MID + FT_R} ${KEY_D}`} />
          <path
            d={`M${THREE_SIDE} 0 L${THREE_SIDE} ${THREE_STRAIGHT} A${THREE_R} ${THREE_R} 0 0 0 ${W - THREE_SIDE} ${THREE_STRAIGHT} L${W - THREE_SIDE} 0`}
          />
          <path d={`M${MID - NO_CHARGE_R} ${BASKET_FROM_BASELINE_M} A${NO_CHARGE_R} ${NO_CHARGE_R} 0 0 0 ${MID + NO_CHARGE_R} ${BASKET_FROM_BASELINE_M}`} />
          <line x1={MID - 0.9} x2={MID + 0.9} y1={1.2} y2={1.2} />
          <circle cx={MID} cy={BASKET_FROM_BASELINE_M} r={0.225} />
          <path d={`M${MID - FT_R} ${H} A${FT_R} ${FT_R} 0 0 1 ${MID + FT_R} ${H}`} />
        </g>
      </svg>
      {children}
    </div>
  );
}
