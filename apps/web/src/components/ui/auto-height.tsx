"use client"

import * as React from "react"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { springs, useReducedMotionSafe } from "@/lib/motion"

/**
 * Springs its own height to whatever its content measures, so content that
 * changes size (a phase swap in a dialog, a list collapsing to a chip, a
 * status strip appearing) moves everything below it continuously instead of
 * in a jump. Swaps inside should use AnimatePresence mode="popLayout" so the
 * leaving content stops counting toward the height the moment it leaves.
 *
 * Overflow is only clipped while the height is moving, so focus rings and
 * shadows at the edges show the rest of the time.
 */
export function AutoHeight({
  children,
  className,
  innerClassName,
}: {
  children: React.ReactNode
  className?: string
  innerClassName?: string
}) {
  const innerRef = React.useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = React.useState<number | "auto">("auto")
  const [moving, setMoving] = React.useState(false)
  const reduced = useReducedMotionSafe()

  React.useLayoutEffect(() => {
    const el = innerRef.current
    if (!el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <motion.div
      initial={false}
      animate={{ height }}
      transition={reduced ? { duration: 0 } : springs.standard}
      onAnimationStart={() => setMoving(true)}
      onAnimationComplete={() => setMoving(false)}
      style={{ overflow: moving ? "hidden" : "visible" }}
      className={cn("relative", className)}
    >
      <div ref={innerRef} className={innerClassName}>
        {children}
      </div>
    </motion.div>
  )
}
