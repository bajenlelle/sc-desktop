"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Moon, Sun, LogOut, User as UserIcon, Building2, ChevronDown, Check, Laptop, LifeBuoy, Settings } from "lucide-react";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import { LogoMark, Wordmark } from "@/components/logo";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { PlanBadge } from "@/components/plan-badge";
import { SpaceHeader } from "@/components/space-header";
import { useImportQuota } from "@/lib/use-import-quota";
import { openUpgradeFlow } from "@/lib/billing";
import { toast } from "sonner";

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </Button>
  );
}

export function Navbar({ profile }: { profile: UserProfile | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { myOrgs, activeOrg, activeOrgId, activeOrgRole, activeOrgIsPersonal, isPlayerOnly, setActiveOrg } = useAuth();
  const importQuota = useImportQuota();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const showOrganization = !isPlayerOnly && !activeOrgIsPersonal && activeOrgRole !== null;
  const hasOrg = !profile || !!profile.isPlatformAdmin || myOrgs.length > 0;
  // Show the "Get the desktop app" CTA to any signed-in user. Even team-org
  // players have a personal org — the desktop app lets them scout their
  // own matches there, not just consume shared playlists.
  const showDesktopCTA = hasOrg;
  const DESKTOP_APP_URL = "https://scoutable.se/#download";
  const DESKTOP_APP_TOOLTIP = "Full scouting workflow lives in the desktop app";
  // Player-only users navigate by content, not by tenancy: two fixed
  // destinations, no space switcher. Org management is secondary nav — it
  // lives in the space menu and on the profile, not in this bar.
  const navLinks = isPlayerOnly
    ? [
        { href: "/my-playlists", label: "My Playlists" },
        { href: "/my-highlights", label: "My Highlights" },
      ]
    : [
        ...(activeOrgIsPersonal
          ? []
          : [{ href: "/my-playlists", label: isCoachOrAdmin ? "Shared Playlists" : "My Playlists" }]),
        // Web is the org-management surface (mobile links out to it), so for
        // club staff Organization is a daily destination — unlike desktop,
        // where it stays in the space menu.
        ...(!activeOrgIsPersonal && isCoachOrAdmin
          ? [{ href: "/organization", label: "Organization" }]
          : []),
        ...(profile?.isPlatformAdmin ? [{ href: "/admin", label: "Admin" }] : []),
      ];

  const initials = (profile?.fullName || profile?.email || "?").slice(0, 2).toUpperCase();
  // Personal orgs sort first, then teams alphabetically.
  const sortedOrgs = [...myOrgs].sort((a, b) => {
    if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
    return a.orgName.localeCompare(b.orgName);
  });
  const activeSpaceLabel = activeOrg
    ? (activeOrg.isPersonal ? "Personal" : activeOrg.orgName)
    : null;
  const ActiveSpaceIcon = activeOrg?.isPersonal ? UserIcon : Building2;

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-50 h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        {/* Logo */}
        <Link href="/my-playlists" className="flex items-center gap-2 shrink-0">
          <LogoMark className="h-7 w-7 rounded-lg" />
          <Wordmark className="h-4 hidden sm:block" />
        </Link>

        {/* Space indicator — coaches/admins only. Player-only users navigate
            by content (My Playlists / My Highlights); tenancy is hidden. */}
        {activeOrg && !isPlayerOnly && (
          <>
            <div className="h-5 w-px bg-border shrink-0" />
            {myOrgs.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="flex gap-1.5 h-8 px-2">
                    <ActiveSpaceIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="max-w-[100px] sm:max-w-[128px] truncate text-sm font-medium">
                      {activeSpaceLabel}
                    </span>
                    <PlanBadge
                      tier={activeOrg.planTier}
                      size="xs"
                      quota={activeOrg.isPersonal ? importQuota : null}
                    />
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Spaces
                  </div>
                  {sortedOrgs.map((org) => {
                    const OrgIcon = org.isPersonal ? UserIcon : Building2;
                    const label = org.isPersonal ? "Personal" : org.orgName;
                    return (
                      <DropdownMenuItem
                        key={org.orgId}
                        onClick={() => setActiveOrg(org.orgId)}
                        className="flex items-center gap-2"
                      >
                        <OrgIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{label}</span>
                        {org.isPersonal ? (
                          // The badge IS the plan entry point — one click to
                          // pricing/portal, replacing the old "Manage plan"
                          // menu item. stopPropagation so it doesn't also
                          // switch the active space.
                          <button
                            type="button"
                            title={
                              org.planTier === "free" || org.planTier === "rookie"
                                ? "Upgrade plan"
                                : "Manage subscription"
                            }
                            onClick={async (e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const err = await openUpgradeFlow(profile?.email);
                              if (err) toast.error(err);
                            }}
                            className="rounded-full transition hover:brightness-110 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                          >
                            <PlanBadge tier={org.planTier} size="xs" showArrow />
                          </button>
                        ) : (
                          <PlanBadge tier={org.planTier} size="xs" />
                        )}
                        {org.orgId === activeOrgId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                  {showOrganization && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href="/organization" className="flex items-center gap-2">
                          <Settings className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="flex-1 truncate">
                            Manage {activeOrg.orgName}
                          </span>
                        </Link>
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <SpaceHeader
                org={activeOrg}
                soloPersonal={activeOrg.isPersonal}
                importQuota={importQuota}
                className="min-w-0"
              />
            )}
          </>
        )}

        {/* Desktop nav */}
        {hasOrg && (
          <nav className="hidden md:flex items-center gap-1 ml-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  pathname.startsWith(link.href)
                    ? "text-foreground bg-muted"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side */}
        <div className="flex items-center gap-2">
          {showDesktopCTA && (
            <a
              href={DESKTOP_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={DESKTOP_APP_TOOLTIP}
              className="hidden sm:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Laptop className="h-3.5 w-3.5" />
              Get the desktop app
            </a>
          )}
          <ThemeToggle />

          {/* Profile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="h-8 w-8 rounded-full overflow-hidden bg-primary/15 flex items-center justify-center text-xs font-semibold text-primary hover:opacity-80 transition-opacity shrink-0">
                {profile?.avatarUrl
                  ? <img src={profile.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
                  : <span>{initials}</span>
                }
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(profile?.fullName || profile?.email) && (
                <>
                  <div className="px-2 py-1.5 text-sm font-medium text-foreground truncate">
                    {profile.fullName ?? profile.email}
                  </div>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem asChild>
                <Link href="/profile" className="flex items-center gap-2">
                  <UserIcon className="h-3.5 w-3.5" />
                  Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-2"
                onClick={() => setReportOpen(true)}
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                Send feedback
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex items-center gap-2 text-destructive focus:text-destructive"
                onClick={handleSignOut}
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} />

          {/* Mobile hamburger */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
                <Menu className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <LogoMark className="h-7 w-7 rounded-lg" />
                  <Wordmark className="h-4" />
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-6 flex flex-col gap-1">
                {hasOrg && navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setSheetOpen(false)}
                    className={cn(
                      "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                      pathname.startsWith(link.href)
                        ? "text-foreground bg-muted"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
                <Link
                  href="/profile"
                  onClick={() => setSheetOpen(false)}
                  className={cn(
                    "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    pathname === "/profile"
                      ? "text-foreground bg-muted"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  Profile
                </Link>
                {showDesktopCTA && (
                  <a
                    href={DESKTOP_APP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setSheetOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <Laptop className="h-3.5 w-3.5" />
                    Get the desktop app
                  </a>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
