"use client"

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * How much of something has been watched, as a small ring (the Podcasts
 * idiom). The arc springs to its value; a full ring becomes a filled disc
 * with a check. `value` is 0–1.
 */
export function ProgressRing({
  value,
  size = 18,
  className,
  label,
}: {
  value: number;
  size?: number;
  className?: string;
  /** Accessible description, e.g. "4 of 12 watched". */
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const done = v >= 1;
  const stroke = 2;
  const r = (size - stroke) / 2;
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {done ? (
        <span className="flex size-full items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-[62%] stroke-[3]" />
        </span>
      ) : (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-fill-3" />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1 1"
            initial={false}
            animate={{ strokeDashoffset: 1 - v }}
            transition={springs.standard}
            className={cn("stroke-primary", v === 0 && "opacity-0")}
          />
        </svg>
      )}
    </span>
  );
}
