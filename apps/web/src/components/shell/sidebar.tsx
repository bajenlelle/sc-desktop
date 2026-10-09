"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Laptop } from "lucide-react";
import { activeDestination, sidebarDestinations } from "@scoutable/shared/lib/app-nav";
import { useAuth } from "@/components/auth-context";
import { LogoMark, Wordmark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { DESTINATION_ICON, useNavUser } from "./nav";
import { SpaceSwitcher } from "./space-switcher";

export const DESKTOP_APP_URL = "https://scoutable.se/#download";

function NavItem({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-sm font-medium outline-none transition-[background-color,transform] duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection pointer-coarse:h-10",
        active ? "bg-selection text-selection-foreground" : "text-foreground hover:bg-fill-1 active:bg-fill-2",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-selection-foreground" : "text-primary")} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * Where scouting itself happens: importing, cutting and sharing live in the
 * desktop app, so the web sidebar keeps the way there one click away (the
 * desktop app's sidebar shows its update card in this place).
 */
function DesktopAppCard() {
  return (
    <a
      href={DESKTOP_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-lg bg-fill-1 p-3 outline-none transition-[background-color,transform] duration-100 hover:bg-fill-2 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection"
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Laptop className="size-4 text-primary" />
        Get the desktop app
        <ArrowUpRight className="ml-auto size-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      </span>
      <span className="mt-0.5 block text-callout text-muted-foreground">Import games, cut clips and share them.</span>
    </a>
  );
}

/**
 * The source list beside the content on wide screens: the space at the top,
 * the destinations, and the account at the bottom. Player-only users have no
 * space to switch, so the wordmark takes its place.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { user, activeOrg, isPlayerOnly } = useAuth();
  const navUser = useNavUser();
  const destinations = navUser ? sidebarDestinations(navUser) : [];
  const active = activeDestination(pathname, destinations);

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] flex-col border-r border-separator bg-sidebar select-none lg:flex">
      <div className="h-3 shrink-0" />

      {navUser && activeOrg && !isPlayerOnly && <SpaceSwitcher org={activeOrg} />}
      {navUser && isPlayerOnly && (
        <Link
          href="/my-playlists"
          aria-label="Scoutable"
          className="mx-2 flex h-10 items-center gap-2 rounded-md px-2 outline-none focus-visible:ring-2 focus-visible:ring-selection"
        >
          <LogoMark className="size-7 rounded-md" />
          <Wordmark className="h-3.5" />
        </Link>
      )}

      {destinations.length > 0 && (
        <nav aria-label="Main" className="mt-3 flex flex-col gap-0.5 px-2">
          {destinations.map((d) => (
            <NavItem key={d.id} href={d.href} icon={DESTINATION_ICON[d.id]} label={d.label} active={active === d.id} />
          ))}
        </nav>
      )}

      <div className="mt-auto flex flex-col gap-2 p-2">
        {navUser?.hasSpace && <DesktopAppCard />}
        {user && <AccountMenu />}
      </div>
    </aside>
  );
}
