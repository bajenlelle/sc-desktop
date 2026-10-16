"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeDestination, tabDestinations } from "@scoutable/shared/lib/app-nav";
import { cn } from "@/lib/utils";
import { DESTINATION_ICON, useNavUser } from "./nav";

/**
 * iOS's tab bar, under the sidebar's breakpoint: the same destinations plus
 * Profile, on a translucent material over the bottom safe area. The bar is in
 * the first HTML (tabs fill in once the profile loads) so pages never jump;
 * its presence sets --tab-bar-height (globals.css), which pages and toasts
 * clear. Icons sit beside their labels once there is room, as on iPad.
 */
export function TabBar() {
  const pathname = usePathname();
  const navUser = useNavUser();
  const tabs = navUser ? tabDestinations(navUser) : [];
  const active = activeDestination(pathname, tabs);

  return (
    <nav
      id="tab-bar"
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-separator bg-material-toolbar pb-[var(--safe-bottom)] backdrop-blur-xl select-none lg:hidden"
    >
      <div className="mx-auto flex h-[49px] max-w-xl items-stretch px-2">
        {tabs.map((tab) => {
          const Icon = DESTINATION_ICON[tab.id];
          const current = active === tab.id;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] leading-3 font-medium outline-none transition-[color,transform] duration-100 active:scale-95 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection sm:flex-row sm:gap-1.5 sm:text-[13px]",
                current ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-6 shrink-0 stroke-[1.75] sm:size-5" />
              <span className="max-w-full truncate">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
