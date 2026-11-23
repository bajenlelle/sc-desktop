"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "framer-motion"
import { getCurrentWindow } from "@tauri-apps/api/window"

import { cn } from "@/lib/utils"
import { scrimVariants, sheetVariants } from "@/lib/motion"

/**
 * A macOS sheet: a large modal task that drops from under the title bar and
 * leaves the same way. Radix supplies focus, roles and dismissal; the way in
 * and out is a spring. A drag that starts inside the sheet (a resize handle,
 * a scrubber) and ends over the scrim must not count as a click outside.
 */
const SheetOpenContext = React.createContext(false)

function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <SheetOpenContext.Provider value={open}>
      <DialogPrimitive.Root data-slot="sheet" open={open} onOpenChange={onOpenChange}>
        {children}
      </DialogPrimitive.Root>
    </SheetOpenContext.Provider>
  )
}

function SheetContent({
  className,
  children,
  onExitComplete,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Fires after the exit animation. */
  onExitComplete?: () => void
}) {
  const open = React.useContext(SheetOpenContext)
  const pointerInside = React.useRef(false)

  React.useEffect(() => {
    const up = () => {
      pointerInside.current = false
    }
    window.addEventListener("pointerup", up, true)
    window.addEventListener("pointercancel", up, true)
    return () => {
      window.removeEventListener("pointerup", up, true)
      window.removeEventListener("pointercancel", up, true)
    }
  }, [])

  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <DialogPrimitive.Portal forceMount key="sheet-portal">
          <DialogPrimitive.Overlay forceMount asChild>
            <motion.div
              data-slot="sheet-overlay"
              variants={scrimVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed inset-0 z-50 bg-black/35"
            />
          </DialogPrimitive.Overlay>
          <SheetTitleStrip />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-4 pt-[calc(var(--titlebar-inset)+0.75rem)] pb-4">
            <DialogPrimitive.Content
              forceMount
              asChild
              onInteractOutside={(e) => {
                if (pointerInside.current) e.preventDefault()
                const t = e.detail.originalEvent.target
                // The title strip decides for itself: a click closes, a drag moves the window (SheetTitleStrip).
                if (t instanceof Element && t.closest("[data-tauri-drag-region], [data-sheet-title-strip]")) e.preventDefault()
                onInteractOutside?.(e)
              }}
              {...props}
            >
              <motion.div
                data-slot="sheet-content"
                variants={sheetVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                onPointerDownCapture={() => {
                  pointerInside.current = true
                }}
                className={cn(
                  "pointer-events-auto relative flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-xl bg-material-sheet text-foreground shadow-sheet outline-none",
                  className
                )}
              >
                {children}
              </motion.div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

/** How far a press on the title strip moves before it is a window drag rather than a click. */
const DRAG_SLOP = 4

/**
 * The title bar's band over the scrim (macOS; it is 0 px where the title bar doesn't lie over the page). With the
 * overlay title bar nothing is draggable unless it says so, so a sheet would pin the window: the strip moves it.
 * It is the scrim too, as the dim page beside the sheet is: a click on it (the toolbar behind, say) closes the
 * sheet. Tauri's own drag region starts the drag on the press and the drag swallows the release, so no click
 * could ever be told from a drag there; here the drag starts once the press has moved, with the release still
 * the page's when it hasn't (Apple's tap and drag: a few points of slop before a direction is committed to).
 * Pointer-events-auto, because a modal dialog sets pointer-events: none on the body.
 */
function SheetTitleStrip() {
  const press = React.useRef<{ x: number; y: number; id: number } | null>(null)
  const dragged = React.useRef(false)
  return (
    <DialogPrimitive.Close asChild>
      <div
        data-sheet-title-strip
        aria-hidden
        tabIndex={-1}
        onPointerDown={(e) => {
          dragged.current = false
          if (e.button !== 0) return
          press.current = { x: e.screenX, y: e.screenY, id: e.pointerId }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const at = press.current
          if (!at || at.id !== e.pointerId) return
          if (Math.hypot(e.screenX - at.x, e.screenY - at.y) < DRAG_SLOP) return
          press.current = null
          dragged.current = true
          e.currentTarget.releasePointerCapture(e.pointerId)
          void getCurrentWindow().startDragging()
        }}
        onPointerUp={() => {
          press.current = null
        }}
        onPointerCancel={() => {
          press.current = null
        }}
        onClick={(e) => {
          // A drag that ends with a click in the page (the system usually keeps that release) closes nothing.
          if (dragged.current) e.preventDefault()
          dragged.current = false
        }}
        className="pointer-events-auto fixed inset-x-0 top-0 z-50 h-[var(--titlebar-inset)] outline-none"
      />
    </DialogPrimitive.Close>
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-title-3 text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

const SheetClose = DialogPrimitive.Close

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle }
