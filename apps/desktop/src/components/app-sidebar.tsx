import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  BookOpen,
  Building2,
  Film,
  ListVideo,
  Plus,
  Share2,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@supabase/supabase-js";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

function getInitials(user: User): string {
  const email = user.email ?? "";
  const name = user.user_metadata?.full_name as string | undefined;
  if (name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function SidebarIconButton({
  href,
  icon: Icon,
  label,
  isActive,
  className,
  onClickWhileActive,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  className?: string;
  onClickWhileActive?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={href}
          onClick={(e) => {
            if (isActive && onClickWhileActive) {
              e.preventDefault();
              onClickWhileActive();
            }
          }}
        >
          <div
            className={cn(
              "h-10 w-10 flex items-center justify-center rounded-lg transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              className
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const { user, profile, profileLoading } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();

  const isCoachOrAdmin = profile?.role === "coach" || profile?.role === "admin";

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    navigate("/auth/login");
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar h-screen">
      {/* Logo */}
      <div className="flex h-14 items-center justify-center border-b border-sidebar-border">
        <Link to="/">
          <LogoMark className="h-9 w-9 rounded-lg" />
        </Link>
      </div>

      {/* Nav items */}
      {user && !profileLoading && (
        <nav className="flex flex-col items-center gap-1 py-3">
          {/* Playlists editor: coaches and admins only */}
          {isCoachOrAdmin && (
            <SidebarIconButton
              href="/playlists"
              icon={ListVideo}
              label="Playlists"
              isActive={pathname.startsWith("/playlists") && !pathname.startsWith("/my-playlists")}
              onClickWhileActive={() => window.dispatchEvent(new CustomEvent("playlist-browser-toggle"))}
            />
          )}
          {/* My Playlists: all roles */}
          <SidebarIconButton
            href="/my-playlists"
            icon={isCoachOrAdmin ? Share2 : BookOpen}
            label={isCoachOrAdmin ? "Shared Playlists" : "My Playlists"}
            isActive={pathname.startsWith("/my-playlists")}
          />
          {/* Library: coaches and admins only */}
          {isCoachOrAdmin && (
            <SidebarIconButton
              href="/matches"
              icon={Film}
              label="Library"
              isActive={pathname.startsWith("/matches")}
            />
          )}
          {/* Organization: all roles */}
          <SidebarIconButton
            href="/organization"
            icon={Building2}
            label="Organization"
            isActive={pathname.startsWith("/organization")}
          />
        </nav>
      )}

      {/* Bottom utilities */}
      <div className="mt-auto flex flex-col items-center gap-1 border-t border-sidebar-border py-3">
        {user && !profileLoading && isCoachOrAdmin && (
          <SidebarIconButton
            href="/upload"
            icon={Plus}
            label="Add Game"
            isActive={pathname === "/upload"}
            className="text-primary"
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="relative h-10 w-10 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              <Sun className="h-5 w-5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          </TooltipContent>
        </Tooltip>
        {user && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/profile"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  pathname === "/profile"
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/15 text-primary hover:bg-primary/25"
                )}
              >
                {getInitials(user)}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Your profile</TooltipContent>
          </Tooltip>
        )}
        {user && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="h-10 w-10 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={handleSignOut}
              >
                <LogOut className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
