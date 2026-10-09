"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LogOut, MessageSquarePlus, MoreHorizontal, SunMoon, UserRound } from "lucide-react";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import { useAuth } from "@/components/auth-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

function initials(name: string): string {
  const parts = name.trim().split(/[\s@.]+/).filter(Boolean);
  if (parts.length >= 2 && !name.includes("@")) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0] ?? "?").slice(0, 2).toUpperCase();
}

/**
 * The sidebar's footer: who is signed in, and the account-level actions.
 * Appearance follows the system unless Light or Dark is picked here (or in
 * Profile); the pick syncs to the account like the colour themes.
 */
export function AccountMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { profile } = useShell();
  const { theme, setTheme } = useTheme();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const email = profile?.email ?? user?.email ?? null;
  const name = profile?.fullName || email || "Account";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2",
              pathname === "/profile" && "bg-fill-1",
            )}
          >
            <Avatar className="size-7">
              {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" className="object-cover" />}
              <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                {initials(name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              {email && name !== email && (
                <span className="block truncate text-subheadline text-muted-foreground">{email}</span>
              )}
            </span>
            <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-56">
          <DropdownMenuItem asChild>
            <Link href="/profile">
              <UserRound className="text-muted-foreground" />
              Profile
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <SunMoon className="text-muted-foreground" />
              Appearance
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setFeedbackOpen(true)}>
            <MessageSquarePlus className="text-muted-foreground" />
            Send feedback…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void handleSignOut()}>
            <LogOut className="text-muted-foreground" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportProblemDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
