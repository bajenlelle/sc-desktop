import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Feedback lives on the press: `active:` scales the button down the instant
 * the pointer goes down, the fill darkens one step, and both settle on
 * release. Disabled buttons keep pointer events so a `title` or a wrapping
 * tooltip can explain why they are off; native disabled buttons swallow
 * clicks on their own. On touch screens every size steps up so the target
 * is 44pt (36pt for the smallest inline buttons), as iOS asks.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[background-color,color,border-color,box-shadow,transform,opacity] duration-150 ease-spring active:scale-[0.97] active:duration-75 disabled:cursor-default disabled:opacity-50 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:hover:bg-primary [&_svg]:stroke-2",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 active:bg-destructive/80 disabled:hover:bg-destructive [&_svg]:stroke-2",
        outline:
          "bg-card text-foreground shadow-xs ring-1 ring-separator hover:bg-fill-1 active:bg-fill-3 disabled:hover:bg-card",
        secondary:
          "bg-fill-2 text-foreground hover:bg-fill-3 active:bg-fill-4 disabled:hover:bg-fill-2",
        ghost: "text-foreground hover:bg-fill-1 active:bg-fill-3 disabled:hover:bg-transparent",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3 pointer-coarse:h-11 pointer-coarse:px-5",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3 pointer-coarse:h-9 pointer-coarse:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 pointer-coarse:h-10 pointer-coarse:px-4",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4 pointer-coarse:h-12",
        icon: "size-9 pointer-coarse:size-11",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3 pointer-coarse:size-9",
        "icon-sm": "size-8 pointer-coarse:size-10",
        "icon-lg": "size-10 pointer-coarse:size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
