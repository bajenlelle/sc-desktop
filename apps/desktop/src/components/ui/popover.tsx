import * as React from "react"
import { Popover as PopoverPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Inside a sheet or dialog (a modal Radix dialog), a popover whose content
 * scrolls must be `modal`: the dialog locks scrolling to its own content, and
 * the popover renders in a portal outside it, so its list ignores the wheel
 * unless it takes the lock itself while open (menus do this on their own).
 */
const PopoverCloseContext = React.createContext<(() => void) | null>(null)

/**
 * The root keeps track of whether it is open, controlled or not, so the
 * content can close it for a press Radix never hears the end of (below).
 */
function Popover({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(!!defaultOpen)
  const isControlled = openProp !== undefined
  const open = isControlled ? !!openProp : uncontrolledOpen
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )
  const close = React.useCallback(() => handleOpenChange(false), [handleOpenChange])
  return (
    <PopoverCloseContext.Provider value={close}>
      <PopoverPrimitive.Root data-slot="popover" open={open} onOpenChange={handleOpenChange} {...props} />
    </PopoverCloseContext.Provider>
  )
}

/**
 * A popover closes on a press anywhere outside it, the window's title zone
 * included. Radix closes a popover on the click that follows a press outside,
 * and a press on a window drag region (the title strip, the tab bar, a
 * toolbar's empty part) never becomes one: Tauri's script takes the mousedown
 * to start a native window drag, and the drag swallows the release. So the
 * press itself closes it there. Mounted with the content, so only while open.
 */
function CloseOnWindowDrag() {
  const close = React.useContext(PopoverCloseContext)
  React.useEffect(() => {
    if (!close) return
    const onPointerDown = (e: PointerEvent) => {
      // The condition Tauri starts a drag on: the element pressed carries the attribute itself.
      const attr = e.target instanceof Element ? e.target.getAttribute("data-tauri-drag-region") : null
      if (e.button === 0 && attr !== null && attr !== "false") close()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [close])
  return null
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-lg bg-material-popover p-4 text-popover-foreground shadow-menu backdrop-blur-xl outline-hidden chrome-animate",
          className
        )}
        {...props}
      >
        {children}
        <CloseOnWindowDrag />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-1 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <div
      data-slot="popover-title"
      className={cn("text-headline", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
}
