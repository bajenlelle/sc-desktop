"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { AnimatePresence, motion, useDragControls, type PanInfo, type Variants } from "framer-motion"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { dialogVariants, scrimVariants, springs } from "@/lib/motion"
import { usePortalContainer } from "@/lib/portal-container"

/**
 * Radix for focus, roles and dismissal; framer-motion for the way in and
 * out. The scrim and the panel are kept mounted by AnimatePresence while the
 * exit spring runs, so closing is a motion, not a cut, and reopening
 * mid-exit continues from where the panel is. `onExitComplete` lets a
 * caller navigate only once the dialog has fully left.
 *
 * On phones (under 640px) the panel is iOS's sheet instead: it rises from
 * the bottom edge at full width, clears the home indicator, and its grabber
 * drags it down 1:1; a pull past a third of the way or a flick dismisses it,
 * anything less springs back.
 */
const DialogOpenContext = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({
  open: false,
  setOpen: () => {},
})

const COMPACT_QUERY = "(max-width: 639px)"
function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}
/** Phone-width screens; false while rendering on the server (dialogs open later). */
function useCompact() {
  return React.useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false
  )
}

const sheetVariants: Variants = {
  hidden: { y: "100%" },
  visible: { y: 0, transition: springs.gentle },
  exit: { y: "100%", transition: springs.exit },
}

function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
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
  const context = React.useMemo(() => ({ open, setOpen: handleOpenChange }), [open, handleOpenChange])
  return (
    <DialogOpenContext.Provider value={context}>
      <DialogPrimitive.Root data-slot="dialog" open={open} onOpenChange={handleOpenChange} {...props}>
        {children}
      </DialogPrimitive.Root>
    </DialogOpenContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/40", className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onExitComplete,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /** Fires after the exit animation; navigate from here, not from the action. */
  onExitComplete?: () => void
}) {
  const { open, setOpen } = React.useContext(DialogOpenContext)
  const compact = useCompact()
  const container = usePortalContainer()
  const dragControls = useDragControls()
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 160 || info.velocity.y > 600) setOpen(false)
  }
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <DialogPrimitive.Portal forceMount key="dialog-portal" container={container}>
          <DialogPrimitive.Overlay forceMount asChild>
            <motion.div
              data-slot="dialog-overlay"
              variants={scrimVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="fixed inset-0 z-50 bg-black/40"
            />
          </DialogPrimitive.Overlay>
          {/* The wrapper places the panel; it lets pointer events through so
              clicks beside the panel reach the scrim and count as "outside". */}
          <div
            className={cn(
              "pointer-events-none fixed inset-0 z-50 flex justify-center",
              compact ? "items-end" : "items-center p-4"
            )}
          >
            <DialogPrimitive.Content forceMount asChild {...props}>
              <motion.div
                data-slot="dialog-content"
                variants={compact ? sheetVariants : dialogVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                drag={compact ? "y" : false}
                dragControls={dragControls}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 1 }}
                onDragEnd={onDragEnd}
                className={cn(
                  "pointer-events-auto relative grid w-full gap-4 overflow-y-auto bg-material-sheet text-foreground shadow-dialog outline-none",
                  compact
                    ? "max-h-[calc(100dvh-var(--safe-top)-2.5rem)] rounded-t-[14px] px-5 pt-3 pb-[calc(1.5rem+var(--safe-bottom))]"
                    : "max-h-[calc(100vh-2rem)] max-w-lg rounded-window p-6",
                  className
                )}
              >
                {compact && (
                  <div
                    aria-hidden
                    onPointerDown={(e) => dragControls.start(e)}
                    className="-mx-5 -mt-3 flex h-6 cursor-grab touch-none items-start justify-center pt-2 active:cursor-grabbing"
                  >
                    <span className="h-1.5 w-9 rounded-full bg-fill-4" />
                  </div>
                )}
                {children}
                {showCloseButton && (
                  <DialogPrimitive.Close
                    data-slot="dialog-close"
                    className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full bg-fill-2 text-muted-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-fill-3 hover:text-foreground active:scale-95 active:bg-fill-4 focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:top-4 pointer-coarse:right-4 pointer-coarse:size-8 [&_svg]:size-3.5"
                  >
                    <XIcon />
                    <span className="sr-only">Close</span>
                  </DialogPrimitive.Close>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-row justify-end gap-2", className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-title-3 text-foreground", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
