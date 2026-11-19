"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion } from "framer-motion"

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
          {/* With the overlay title bar nothing is draggable unless it says so,
              so a sheet would pin the window. The strip stays childless (Tauri
              starts the drag only when the target itself has the attribute) and
              pointer-events-auto, because a modal dialog sets pointer-events:
              none on the body. */}
          <div
            data-tauri-drag-region
            aria-hidden
            className="pointer-events-auto fixed inset-x-0 top-0 z-50 h-[var(--titlebar-inset)]"
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center px-4 pt-[calc(var(--titlebar-inset)+0.75rem)] pb-4">
            <DialogPrimitive.Content
              forceMount
              asChild
              onInteractOutside={(e) => {
                if (pointerInside.current) e.preventDefault()
                const t = e.detail.originalEvent.target
                if (t instanceof Element && t.closest("[data-tauri-drag-region]")) e.preventDefault()
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
