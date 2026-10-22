import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LogOut, MessageSquarePlus, MoreHorizontal, Settings, UserRound } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials } from "@scoutable/shared/lib/playlist-feed";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** The profile picture when there is one and it loads, else the initials. */
function UserAvatar({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!url && failed !== url;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
      {showImage ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailed(url)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** The sidebar's footer: who is signed in, and the account-level actions. */
export function UserMenu({ user }: { user: User }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Help › Send Feedback… in the native menu opens the same dialog; the
  // sidebar is mounted on every authed route, matching where it is reachable.
  useEffect(() => {
    const handler = () => setFeedbackOpen(true);
    window.addEventListener("menu-send-feedback", handler);
    return () => window.removeEventListener("menu-send-feedback", handler);
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    navigate("/auth/login");
  }

  // The profile is what Profile edits; the auth metadata only holds the name from sign-up.
  const name =
    profile?.fullName?.trim() || (user.user_metadata?.full_name as string | undefined) || user.email || "Account";
  const onProfile = pathname === "/profile";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-fill-1 active:scale-[0.99] active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2",
              onProfile && "bg-fill-1",
            )}
          >
            <UserAvatar name={name} url={profile?.avatarUrl ?? null} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              {user.email && name !== user.email && (
                <span className="block truncate text-subheadline text-muted-foreground">{user.email}</span>
              )}
            </span>
            <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-56">
          <DropdownMenuItem onSelect={() => navigate("/profile")}>
            <UserRound className="text-muted-foreground" />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <Settings className="text-muted-foreground" />
            Settings
            <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
          </DropdownMenuItem>
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
