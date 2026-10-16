"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { motion } from "framer-motion"

import { cn } from "@/lib/utils"
import { springs } from "@/lib/motion"

/** A macOS toggle: the thumb springs across, the track tints. */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-[34px] shrink-0 cursor-default items-center rounded-full bg-fill-4 p-0.5 outline-none transition-colors duration-150 data-[state=checked]:justify-end data-[state=checked]:bg-primary focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          layout
          transition={springs.snappy}
          className="block size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.3)]"
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
