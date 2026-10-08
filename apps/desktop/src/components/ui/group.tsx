import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * macOS grouped (inset) lists: a rounded card holding rows separated by
 * hairlines, with a bold headline above and a quiet footnote below. Rows
 * that act like buttons fill on hover and press on pointer-down.
 */
export function GroupedList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="grouped-list"
      className={cn("divide-y divide-separator overflow-hidden rounded-window bg-card ring-1 ring-separator", className)}
      {...props}
    />
  )
}

export function GroupHeader({
  title,
  action,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={cn("flex items-end justify-between gap-3 px-1 pb-2", className)} {...props}>
      <h2 className="text-headline text-foreground">{title}</h2>
      {action && <div className="flex items-center gap-2 text-sm">{action}</div>}
    </div>
  )
}

export function GroupFooter({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("px-1 pt-2 text-subheadline text-muted-foreground", className)} {...props} />
}

export interface GroupRowProps {
  label?: React.ReactNode
  description?: React.ReactNode
  leading?: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  onClick?: () => void
  disabled?: boolean
  className?: string
  children?: React.ReactNode
}

export function GroupRow({
  label,
  description,
  leading,
  trailing,
  chevron,
  onClick,
  disabled,
  className,
  children,
}: GroupRowProps) {
  const interactive = !!onClick
  const body = children ?? (
    <>
      {leading && (
        <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4">{leading}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{label}</span>
        {description && <span className="text-callout text-muted-foreground">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{trailing}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
    </>
  )
  const classes = cn(
    "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left",
    interactive &&
      "cursor-default outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection disabled:opacity-50 disabled:hover:bg-transparent",
    className
  )
  if (interactive) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={classes}>
        {body}
      </button>
    )
  }
  return <div className={classes}>{body}</div>
}
