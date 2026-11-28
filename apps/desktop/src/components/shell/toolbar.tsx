import * as React from "react";
import { flushSync } from "react-dom";
import { ChevronLeft, ListTree, ListVideo, PanelLeft } from "lucide-react";
import {
  INITIAL_TOOLBAR_FIT,
  settleToolbarFit,
  type ToolbarFit,
  type ToolbarFitLevel,
  type ToolbarMeasure,
} from "@scoutable/shared/lib/toolbar-fit";
import { cn } from "@/lib/utils";
import { IS_MACOS } from "@/lib/platform";
import { toggleSidebar, useSidebarCollapsed } from "@/lib/sidebar-store";
import { reportSections, toggleBrowser, useBrowserCollapsed, useBrowserPresent } from "@/lib/playlist-browser-store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBack, type BackFallback } from "@/lib/nav-history";
import { usePageScroll } from "./page";

/**
 * How much of the toolbar shows (packages/shared/lib/toolbar-fit.ts): 0 the full bar; 1 compact, too narrow for
 * its actions' labels, which show their icons only (with the label as a tooltip), as a Mac toolbar switches to
 * Icon Only rather than squeezing its title away; 2 tight, where what is left to give way goes too (a subtitle,
 * "Adding to" before a playlist's name).
 */
const ToolbarFitContext = React.createContext<ToolbarFitLevel>(0);
export function useToolbarCompact(): boolean {
  return React.useContext(ToolbarFitContext) >= 1;
}
export function useToolbarTight(): boolean {
  return React.useContext(ToolbarFitContext) === 2;
}

/**
 * A toolbar action that keeps its label while the bar has room and drops it when the bar is compact: the
 * render function gets `compact` to leave the label out, and the label becomes the action's tooltip. Rendered
 * inside the toolbar, so it reads the toolbar's own width. The tooltip is there at both widths, only opening
 * while compact, so a change of width keeps the same button (and the keyboard's focus on it).
 */
export function ToolbarAction({ label, children }: { label: string; children: (compact: boolean) => React.ReactElement }) {
  const compact = useToolbarCompact();
  const [open, setOpen] = React.useState(false);
  return (
    <Tooltip open={compact && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children(compact)}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * "‹ {where it goes}" at a toolbar's leading edge (lib/nav-history.ts): the page the coach came from, by name,
 * and Back goes there as ⌘[ does; with nothing behind, up to the page's place in the app (`fallback`), or no
 * button at all on the sidebar's own pages. In a compact toolbar the chevron alone, as iOS drops a back
 * button's title before anything else, with the destination as its name and "Back to …" as its tooltip.
 */
export function ToolbarBackButton({ fallback }: { fallback?: BackFallback }) {
  const back = useBack(fallback);
  if (!back) return null;
  return (
    <ToolbarAction label={`Back to ${back.label}`}>
      {(compact) => (
        <Button
          variant="ghost"
          size={compact ? "icon-sm" : "sm"}
          aria-label={compact ? back.label : undefined}
          className={cn("min-w-0 shrink text-muted-foreground", compact ? "-ml-1.5" : "-ml-1")}
          onClick={back.go}
        >
          <ChevronLeft className="shrink-0" />
          {!compact && <span className="max-w-48 truncate">{back.label}</span>}
        </Button>
      )}
    </ToolbarAction>
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

/**
 * The bar as `nextToolbarFit` reads it: its width, what is beside the title at their natural widths (in auto
 * mode nothing but the title area shrinks, so a box's width is its natural one), and the title's natural width:
 * the h1's, plus whatever a truncating part inside it hides (the game's title as a menu, with the sidebar hidden).
 */
function measureBar(header: HTMLElement, titleArea: HTMLElement): ToolbarMeasure {
  const style = getComputedStyle(header);
  let other = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  let inFlow = 0;
  for (const child of Array.from(header.children)) {
    const childStyle = getComputedStyle(child);
    if (childStyle.position === "absolute" || childStyle.display === "none") continue;
    inFlow++;
    if (child !== titleArea) other += child.getBoundingClientRect().width - transientWidth(child);
  }
  other += (parseFloat(style.columnGap) || 0) * Math.max(0, inFlow - 1);
  // In the title's area, a subtitle shares the title's room (and would squeeze it): it counts as beside the title,
  // whole, so it stays whole until a tight bar hides it, and its going is a step's saving.
  let titleWidth = 0;
  let parts = 0;
  for (const part of Array.from(titleArea.children) as HTMLElement[]) {
    if (getComputedStyle(part).display === "none") continue;
    parts++;
    if (part.tagName === "H1") titleWidth = naturalWidth(part);
    else other += naturalWidth(part);
  }
  other += (parseFloat(getComputedStyle(titleArea).columnGap) || 0) * Math.max(0, parts - 1);
  return { headerWidth: header.getBoundingClientRect().width, other, titleWidth };
}

/**
 * What a status that comes and goes takes inside a box (`data-toolbar-transient`: Details' "Saved", the ring of
 * clips being sent to another playlist), with its gap: left out of the measure, so a few seconds of status lets
 * the title give way a little rather than move every label out and back.
 */
function transientWidth(box: Element): number {
  let width = 0;
  for (const el of Array.from(box.querySelectorAll("[data-toolbar-transient]"))) {
    width += el.getBoundingClientRect().width;
    const parent = el.parentElement;
    if (parent && parent.childElementCount > 1) width += parseFloat(getComputedStyle(parent).columnGap) || 0;
  }
  return width;
}

/** A box's width whole: what it shows, plus whatever it or a truncating part inside it cuts off. */
function naturalWidth(box: HTMLElement): number {
  let width = box.clientWidth;
  for (const el of [box, ...Array.from(box.querySelectorAll<HTMLElement>(".truncate"))]) {
    const hidden = el.scrollWidth - el.clientWidth;
    if (hidden > 1) width += hidden;
  }
  return width;
}

/**
 * The auto level: measured whenever the bar's width or anything in it changes (a title, a playlist chosen, a
 * count), and settled before the frame is painted (flushSync draws each step so the next measure sees it), so
 * no frame shows a cut title or a label that is about to go.
 */
function useAutoFit(
  headerRef: React.RefObject<HTMLElement | null>,
  titleRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
): ToolbarFitLevel {
  const [level, setLevel] = React.useState<ToolbarFitLevel>(0);
  const fit = React.useRef<ToolbarFit>(INITIAL_TOOLBAR_FIT);
  const drawn = React.useRef<ToolbarFitLevel>(0);
  React.useLayoutEffect(() => {
    const header = headerRef.current;
    const titleArea = titleRef.current;
    if (!enabled || !header || !titleArea) {
      fit.current = INITIAL_TOOLBAR_FIT;
      drawn.current = 0;
      setLevel(0);
      return;
    }
    const draw = (next: ToolbarFitLevel) => {
      if (next === drawn.current) return;
      drawn.current = next;
      flushSync(() => setLevel(next));
    };
    const run = () => {
      fit.current = settleToolbarFit(fit.current, (f) => {
        draw(f.level);
        return measureBar(header, titleArea);
      });
      draw(fit.current.level);
    };
    // The first observation is delivered at once, before the first paint.
    const resize = new ResizeObserver(run);
    resize.observe(header);
    // A change inside the bar (our own steps included) is measured again; once settled, a run changes nothing.
    const mutation = new MutationObserver(run);
    mutation.observe(header, { childList: true, subtree: true, characterData: true });
    // An item gone from the bar or its actions (Plays' collect control on Season, say) may have taken part of a
    // saving with it, which would keep the bar a level up with room to spare: the savings are measured anew. Our
    // own steps never add or remove these boxes (they change what is inside them), and a status that comes and goes
    // doesn't count, so this can't feed itself.
    const lasting = (nodes: NodeList) =>
      Array.from(nodes).some((n) => n instanceof Element && !n.hasAttribute("data-toolbar-transient"));
    const watchItems = () => {
      items.disconnect();
      items.observe(header, { childList: true });
      const actions = header.querySelector(":scope > [data-toolbar-actions]");
      if (actions) items.observe(actions, { childList: true });
    };
    const items = new MutationObserver((records) => {
      if (records.some((r) => lasting(r.removedNodes))) {
        fit.current = { ...fit.current, savings: [0, 0], leftOther: null };
      }
      watchItems();
      run();
    });
    watchItems();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      items.disconnect();
    };
  }, [headerRef, titleRef, enabled]);
  return level;
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

/** A report's Sections panel, its second sidebar: the same button and key as the playlist browser's. */
export function ReportSectionsToggle() {
  const present = reportSections.usePresent();
  const collapsed = reportSections.useCollapsed();
  if (!present) return null;
  return (
    <PanelToggle
      label={collapsed ? "Show sections" : "Hide sections"}
      shortcut={IS_MACOS ? "\u2318B" : "Ctrl B"}
      shown={!collapsed}
      onToggle={reportSections.toggle}
    >
      <ListTree className="size-4" />
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
  back,
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
  /**
   * The way back at the leading edge (ToolbarBackButton): the page the coach came from, else this fallback (a
   * game's is Games). Without one, the button shows only when a page is behind this one and the sidebar didn't
   * open it; false for a page whose leading edge goes back within itself.
   */
  back?: BackFallback | false;
  leading?: React.ReactNode;
  principal?: React.ReactNode;
  search?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * Narrower than this (px), the actions show their icons only (`useToolbarCompact`). "auto": by whether the
   * title can show whole, in two steps (compact, then tight: `useToolbarTight`), as the game and team pages do.
   */
  compactBelow?: number | "auto";
  variant?: "scroll" | "static";
  className?: string;
}) {
  const { scrolled } = usePageScroll();
  const collapsed = useSidebarCollapsed();
  const material = variant === "static" || scrolled;
  const fade = variant === "scroll" && material;
  const headerRef = React.useRef<HTMLElement | null>(null);
  const titleRef = React.useRef<HTMLDivElement | null>(null);
  const auto = compactBelow === "auto";
  const belowWidth = useCompactBelow(headerRef, auto ? undefined : compactBelow);
  const autoLevel = useAutoFit(headerRef, titleRef, auto);
  const level: ToolbarFitLevel = auto ? autoLevel : belowWidth ? 1 : 0;
  return (
    <ToolbarFitContext.Provider value={level}>
    <header
      ref={headerRef}
      data-tauri-drag-region
      data-compact={level >= 1 ? "true" : undefined}
      data-fit={auto ? String(level) : undefined}
      data-scrolled={scrolled ? "true" : undefined}
      className={cn(
        "z-20 flex h-[var(--toolbar-height)] shrink-0 items-center gap-3 pr-4 transition-[background-color] duration-200 select-none",
        // Auto: only the title gives way to the width; the rest keep their natural widths and step down instead.
        auto && "[&>*:not([data-toolbar-title])]:shrink-0",
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
      <ReportSectionsToggle />
      {back !== false && <ToolbarBackButton fallback={back} />}
      {leading}
      {/* The title takes the room the bar has between its leading items and its actions, so the actions stay
          put at the right and the title at the left whatever their lengths. A subtitle that is text gives way
          before the title and is cut short as a whole. One built of parts (a count and a link, say) lays them
          out itself in the room the title leaves it (a third at least), and a part that may be cut short
          keeps a minimum of its own (the editor's game keeps a few letters to click); a link inside text that
          is cut short would vanish into the "…" whole. */}
      <div ref={titleRef} data-tauri-drag-region data-toolbar-title className="flex min-w-0 flex-1 items-baseline gap-2">
        <h1
          data-tauri-drag-region
          // Beside a subtitle of parts the title leaves it a third of the room, so its link always shows.
          className={cn("min-w-0 truncate text-title-3 text-foreground", subtitle && typeof subtitle !== "string" && "max-w-[65%]")}
        >
          {title}
        </h1>
        {subtitle &&
          (typeof subtitle === "string" ? (
            // Tight, the subtitle gives its room to the title.
            <span className={cn("min-w-0 shrink-[3] truncate text-subheadline text-muted-foreground nums", level === 2 && "hidden")}>{subtitle}</span>
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
        <div data-toolbar-actions className={cn("flex shrink-0 items-center gap-2", !search && "ml-auto")}>{actions}</div>
      )}
    </header>
    </ToolbarFitContext.Provider>
  );
}
