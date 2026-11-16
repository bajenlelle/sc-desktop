import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { springs } from "@/lib/motion"

/** How far the thumb travels: the track's 34px less its 2px padding either side and the thumb's own 16px. */
const TRAVEL = 14

/**
 * A macOS toggle: the thumb springs across, the track tints. The thumb's
 * place comes from the switch's own state, never from where the page's
 * layout happens to put it: animated by `layout`, it flew out of its track
 * whenever the page around it moved.
 */
function Switch({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const [own, setOwn] = React.useState(defaultChecked ?? false)
  const on = checked ?? own
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={(next) => {
        setOwn(next)
        onCheckedChange?.(next)
      }}
      className={cn(
        "peer inline-flex h-5 w-[34px] shrink-0 cursor-default items-center rounded-full bg-fill-4 p-0.5 outline-none transition-colors duration-150 data-[state=checked]:bg-primary focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          initial={false}
          animate={{ x: on ? TRAVEL : 0 }}
          transition={springs.snappy}
          className="block size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)]"
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
