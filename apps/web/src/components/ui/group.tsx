import * as React from "react"
import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { pressable } from "@/lib/pressable"

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
  /** A red label for actions that delete or sign out. */
  destructive?: boolean
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
  destructive,
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
        <span className={cn("truncate text-sm", destructive ? "text-destructive" : "text-foreground")}>{label}</span>
        {description && <span className="text-callout text-muted-foreground">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{trailing}</span>}
      {chevron && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
    </>
  )
  const classes = cn(
    "flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left",
    interactive &&
      "cursor-default outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:active:bg-transparent",
    className
  )
  if (interactive) {
    // A div, not a <button>: long labels must truncate (see pressable.ts).
    return (
      <div {...pressable(onClick, { disabled })} className={classes}>
        {body}
      </div>
    )
  }
  return <div className={classes}>{body}</div>
}

/** An input inside a FormRow: borderless and right-aligned, as System Settings' fields are. */
export const FORM_ROW_INPUT = "h-7 border-0 bg-transparent px-0 text-right shadow-none ring-0 focus-visible:ring-0"

/** A date input inside a FormRow: compact and outlined, so it reads as a control, not text. */
export const FORM_ROW_DATE = "h-7 w-auto px-2 pointer-coarse:h-9"

/**
 * A settings-style form row: the label in a fixed column on the left, the
 * control on the right (System Settings' form layout). `htmlFor` ties the
 * label to the control for clicks and screen readers.
 */
export function FormRow({
  label,
  htmlFor,
  description,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor?: string
  description?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-h-11 items-center gap-4 px-4 py-2", className)}>
      <div className="flex w-32 shrink-0 flex-col">
        <label htmlFor={htmlFor} className="text-sm text-foreground">
          {label}
        </label>
        {description && <span className="text-callout text-muted-foreground">{description}</span>}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</div>
    </div>
  )
}

/** A tinted note inside or between groups: status, warning or error. */
export function Callout({
  tone = "neutral",
  icon,
  className,
  children,
  action,
}: {
  tone?: "neutral" | "warning" | "destructive" | "success"
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      role={tone === "destructive" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-window px-3 py-2.5 text-callout",
        tone === "neutral" && "bg-fill-1 text-foreground",
        tone === "warning" && "bg-warning/12 text-foreground",
        tone === "destructive" && "bg-destructive/10 text-foreground",
        tone === "success" && "bg-success/12 text-foreground",
        className
      )}
    >
      {icon && (
        <span
          className={cn(
            "mt-px flex shrink-0 [&_svg]:size-4",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
            tone === "success" && "text-success",
            tone === "neutral" && "text-muted-foreground"
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
