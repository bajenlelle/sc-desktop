import * as React from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { IS_MACOS } from "@/lib/platform";
import { toggleSidebar, useSidebarCollapsed } from "@/lib/sidebar-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageScroll } from "./page";

export function SidebarToggle() {
  const collapsed = useSidebarCollapsed();
  const label = collapsed ? "Show sidebar" : "Hide sidebar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={!collapsed}
          onClick={toggleSidebar}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 hover:text-foreground active:scale-95 active:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <PanelLeft className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The content column's toolbar. `scroll` pages float it over the scroller:
 * transparent while the page sits at the top, a translucent material with a
 * soft lower edge once content has passed under it (the scroll-edge effect,
 * instead of a line). `static` layouts (split views) keep it in flow with a
 * hairline. The bar and the title are drag regions for the window; when the
 * sidebar is hidden on macOS the bar pads for the traffic lights.
 */
export function Toolbar({
  title,
  subtitle,
  leading,
  search,
  actions,
  variant = "scroll",
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  search?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "scroll" | "static";
  className?: string;
}) {
  const { scrolled } = usePageScroll();
  const collapsed = useSidebarCollapsed();
  const material = variant === "static" || scrolled;
  const fade = variant === "scroll" && material;
  return (
    <header
      data-tauri-drag-region
      data-scrolled={scrolled ? "true" : undefined}
      className={cn(
        "z-20 flex h-[var(--toolbar-height)] shrink-0 items-center gap-3 pr-4 transition-[background-color] duration-200",
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
      {leading}
      <div data-tauri-drag-region className="flex min-w-0 items-baseline gap-2">
        <h1 data-tauri-drag-region className="truncate text-title-3 text-foreground">
          {title}
        </h1>
        {subtitle && <span className="truncate text-subheadline text-muted-foreground">{subtitle}</span>}
      </div>
      {search && <div className="ml-auto w-48 shrink-0 md:w-56">{search}</div>}
      {actions && (
        <div className={cn("flex shrink-0 items-center gap-2", !search && "ml-auto")}>{actions}</div>
      )}
    </header>
  );
}
