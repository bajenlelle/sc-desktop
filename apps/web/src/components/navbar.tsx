"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Moon, Sun, LogOut, User as UserIcon, ChevronDown, Check } from "lucide-react";
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
  const { myOrgs, activeOrgId, activeOrgRole, activeOrgIsPersonal, setActiveOrg } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const showOrganization = !activeOrgIsPersonal && activeOrgRole !== null;
  const hasOrg = !profile || !!profile.isPlatformAdmin || myOrgs.length > 0;
  const navLinks = [
    { href: "/my-playlists", label: isCoachOrAdmin ? "Shared Playlists" : "My Playlists" },
    ...(showOrganization ? [{ href: "/organization", label: "Organization" }] : []),
    ...(profile?.isPlatformAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  const activeOrgName = myOrgs.find((o) => o.orgId === activeOrgId)?.orgName;
  const initials = (profile?.fullName || profile?.email || "?").slice(0, 2).toUpperCase();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
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

        {/* Workspace switcher — visible on desktop when user has 2+ orgs */}
        {myOrgs.length > 1 && (
          <>
            <div className="hidden md:block h-5 w-px bg-border shrink-0" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="hidden md:flex gap-1.5 h-8 px-2 text-sm font-medium">
                  <span className="max-w-[128px] truncate">{activeOrgName ?? "Select org"}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                {myOrgs.map((org) => (
                  <DropdownMenuItem
                    key={org.orgId}
                    onClick={() => setActiveOrg(org.orgId)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{org.orgName}</span>
                    {org.orgId === activeOrgId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
                {/* Mobile workspace switcher */}
                {myOrgs.length > 1 && (
                  <>
                    {myOrgs.map((org) => (
                      <button
                        key={org.orgId}
                        onClick={() => { setActiveOrg(org.orgId); setSheetOpen(false); }}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors text-left w-full",
                          org.orgId === activeOrgId
                            ? "text-foreground bg-muted"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        )}
                      >
                        <span className="truncate">{org.orgName}</span>
                        {org.orgId === activeOrgId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-border" />
                  </>
                )}
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
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
