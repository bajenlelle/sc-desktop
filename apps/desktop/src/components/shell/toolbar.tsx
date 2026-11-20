import * as React from "react";
import { ListVideo, PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { IS_MACOS } from "@/lib/platform";
import { toggleSidebar, useSidebarCollapsed } from "@/lib/sidebar-store";
import { toggleBrowser, useBrowserCollapsed, useBrowserPresent } from "@/lib/playlist-browser-store";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageScroll } from "./page";

/**
 * Whether the toolbar is in its compact form: too narrow for its actions' labels, they show their icons only
 * (with the label as a tooltip), as a Mac toolbar switches to Icon Only rather than squeezing its title away.
 */
const ToolbarCompactContext = React.createContext(false);
export function useToolbarCompact(): boolean {
  return React.useContext(ToolbarCompactContext);
}

/**
 * A toolbar action that keeps its label while the bar has room and drops it when the bar is compact: the
 * render function gets `compact` to leave the label out, and the label becomes the action's tooltip. Rendered
 * inside the toolbar, so it reads the toolbar's own width.
 */
export function ToolbarAction({ label, children }: { label: string; children: (compact: boolean) => React.ReactElement }) {
  const compact = useToolbarCompact();
  const action = children(compact);
  if (!compact) return action;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{action}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The step between compact and full, so a width at the threshold doesn't flip the bar back and forth. */
const COMPACT_HYSTERESIS = 32;

function useCompactBelow(ref: React.RefObject<HTMLElement | null>, below: number | undefined): boolean {
  const [compact, setCompact] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || below === undefined) {
      setCompact(false);
      return;
    }
    const measure = () => {
      const width = el.getBoundingClientRect().width;
      setCompact((was) => (was ? width < below + COMPACT_HYSTERESIS : width < below));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, below]);
  return compact;
}

/** A toolbar button that shows or hides one panel, with its label and shortcut in the tooltip. */
function PanelToggle({
  label,
  shortcut,
  shown,
  onToggle,
  children,
}: {
  label: string;
  shortcut?: string;
  shown: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={shown}
          onClick={onToggle}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 hover:text-foreground active:scale-95 active:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-1.5">
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

export function SidebarToggle() {
  const collapsed = useSidebarCollapsed();
  return (
    <PanelToggle
      label={collapsed ? "Show sidebar" : "Hide sidebar"}
      shortcut={IS_MACOS ? "\u2303\u2318S" : undefined}
      shown={!collapsed}
      onToggle={toggleSidebar}
    >
      <PanelLeft className="size-4" />
    </PanelToggle>
  );
}

/**
 * The Playlists page's second sidebar, the playlist browser, has its own
 * button beside the app sidebar's, so a closed browser always has a visible
 * way back. Only while that page is on screen.
 */
export function PlaylistBrowserToggle() {
  const present = useBrowserPresent();
  const collapsed = useBrowserCollapsed();
  if (!present) return null;
  return (
    <PanelToggle
      label={collapsed ? "Show playlists" : "Hide playlists"}
      shortcut={IS_MACOS ? "\u2318B" : "Ctrl B"}
      shown={!collapsed}
      onToggle={toggleBrowser}
    >
      <ListVideo className="size-4" />
    </PanelToggle>
  );
}

/**
 * The content column's toolbar. `scroll` pages float it over the scroller:
 * transparent while the page sits at the top, a translucent material with a
 * soft lower edge once content has passed under it (the scroll-edge effect,
 * instead of a line). `static` layouts (split views) keep it in flow with a
 * hairline. The bar and the title are drag regions for the window; when the
 * sidebar is hidden on macOS the bar pads for the traffic lights.
 * `principal` is the centred item (a view switcher, as in Calendar's
 * Day/Week/Month): it sits in the space between the title and the actions.
 */
export function Toolbar({
  title,
  subtitle,
  leading,
  principal,
  search,
  actions,
  compactBelow,
  variant = "scroll",
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  principal?: React.ReactNode;
  search?: React.ReactNode;
  actions?: React.ReactNode;
  /** Narrower than this (px), the actions show their icons only (`useToolbarCompact`). */
  compactBelow?: number;
  variant?: "scroll" | "static";
  className?: string;
}) {
  const { scrolled } = usePageScroll();
  const collapsed = useSidebarCollapsed();
  const material = variant === "static" || scrolled;
  const fade = variant === "scroll" && material;
  const headerRef = React.useRef<HTMLElement | null>(null);
  const compact = useCompactBelow(headerRef, compactBelow);
  return (
    <ToolbarCompactContext.Provider value={compact}>
    <header
      ref={headerRef}
      data-tauri-drag-region
      data-compact={compact ? "true" : undefined}
      data-scrolled={scrolled ? "true" : undefined}
      className={cn(
        "z-20 flex h-[var(--toolbar-height)] shrink-0 items-center gap-3 pr-4 transition-[background-color] duration-200 select-none",
        variant === "scroll" ? "absolute inset-x-0 top-0" : "relative border-b border-separator",
        material ? "bg-material-toolbar backdrop-blur-xl" : "bg-transparent",
        IS_MACOS && collapsed ? "pl-[calc(var(--traffic-lights-width)+0.75rem)]" : "pl-3",
        className,
      )}
      style={
        fade
          ? {
              WebkitMaskImage: "linear-gradient(to bottom, black calc(100% - 10px), transparent)",
              maskImage: "linear-gradient(to bottom, black calc(100% - 10px), transparent)",
            }
          : undefined
      }
    >
      <SidebarToggle />
      <PlaylistBrowserToggle />
      {leading}
      {/* The title takes the room the bar has between its leading items and its actions, so the actions stay
          put at the right and the title at the left whatever their lengths. A subtitle that is text gives way
          before the title and is cut short as a whole. One built of parts (a count and a link, say) lays them
          out itself in the room the title leaves it (a third at least), and a part that may be cut short
          keeps a minimum of its own (the editor's game keeps a few letters to click); a link inside text that
          is cut short would vanish into the "…" whole. */}
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1
          data-tauri-drag-region
          // Beside a subtitle of parts the title leaves it a third of the room, so its link always shows.
          className={cn("min-w-0 truncate text-title-3 text-foreground", subtitle && typeof subtitle !== "string" && "max-w-[65%]")}
        >
          {title}
        </h1>
        {subtitle &&
          (typeof subtitle === "string" ? (
            <span className="min-w-0 shrink-[3] truncate text-subheadline text-muted-foreground nums">{subtitle}</span>
          ) : (
            <span className="flex grow items-baseline whitespace-nowrap text-subheadline text-muted-foreground nums">{subtitle}</span>
          ))}
      </div>
      {/* Centred on the bar itself, so it never shifts when the items beside
          it come and go. Clicks around it fall through to the drag region. */}
      {principal && (
        <div className="pointer-events-none absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center">
          <div className="pointer-events-auto">{principal}</div>
        </div>
      )}
      {search && <div className="ml-auto w-48 shrink-0 md:w-56">{search}</div>}
      {actions && (
        <div className={cn("flex shrink-0 items-center gap-2", !search && "ml-auto")}>{actions}</div>
      )}
    </header>
    </ToolbarCompactContext.Provider>
  );
}
