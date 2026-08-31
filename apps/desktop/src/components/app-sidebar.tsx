import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  BookOpen,
  Building2,
  Film,
  Home,
  ListVideo,
  MessageSquarePlus,
  Plus,
  Settings,
  Share2,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { OrgMembership } from "@/types/org";
import type { User } from "@supabase/supabase-js";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { orgPlanLabel } from "@scoutable/shared/lib/plan-tier";

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

function getOrgInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
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

function WorkspaceIcon({
  org,
  isActive,
  onSelect,
}: {
  org: OrgMembership;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            "h-9 w-9 flex items-center justify-center rounded-lg text-xs font-bold transition-all",
            isActive
              ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-sidebar"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          )}
        >
          {getOrgInitials(org.orgName)}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {org.isPersonal ? "Personal" : org.orgName}
        {org.isNtOrg && " (NT)"}
        <span className="ml-1 text-muted-foreground">· {orgPlanLabel(org.planTier)}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar() {
  const { user, profile, profileLoading, myOrgs, activeOrgId, activeOrgRole, activeOrgIsPersonal, setActiveOrg } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const showOrganization = !activeOrgIsPersonal && activeOrgRole !== null;
  const showWorkspaceSwitcher = myOrgs.length > 1;

  // Native menu: Help → Send Feedback… opens the same dialog as the sidebar
  // button (the sidebar is mounted on every authed route, matching where
  // feedback is reachable today).
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

  return (
    <aside className={cn(
      "flex shrink-0 flex-row border-r border-sidebar-border bg-sidebar h-screen",
      showWorkspaceSwitcher ? "w-[104px]" : "w-14"
    )}>
      {/* Workspace switcher column — visible when user has 2+ orgs */}
      {showWorkspaceSwitcher && (
        <div className="flex w-12 flex-col items-center border-r border-sidebar-border/40 py-3 gap-2">
          {myOrgs.map((org) => (
            <WorkspaceIcon
              key={org.orgId}
              org={org}
              isActive={activeOrgId === org.orgId}
              onSelect={() => setActiveOrg(org.orgId)}
            />
          ))}
        </div>
      )}

      {/* Main nav column */}
      <div className="flex flex-1 flex-col">
        {/* Logo */}
        <div className="flex h-14 items-center justify-center border-b border-sidebar-border">
          <Link to="/">
            <LogoMark className="h-9 w-9 rounded-lg" />
          </Link>
        </div>

        {/* Nav items */}
        {user && !profileLoading && (
          <nav className="flex flex-col items-center gap-1 py-3">
            {/* The Overview page was previously only reachable via the logo —
                the Getting Started checklist lives there, so it needs a real
                nav item. */}
            {isCoachOrAdmin && (
              <SidebarIconButton
                href="/"
                icon={Home}
                label="Home"
                isActive={pathname === "/"}
              />
            )}
            {isCoachOrAdmin && (
              <SidebarIconButton
                href="/playlists"
                icon={ListVideo}
                label="Playlists"
                isActive={pathname.startsWith("/playlists") && !pathname.startsWith("/my-playlists")}
                onClickWhileActive={() => window.dispatchEvent(new CustomEvent("playlist-browser-toggle"))}
              />
            )}
            {!activeOrgIsPersonal && (
              <SidebarIconButton
                href="/my-playlists"
                icon={isCoachOrAdmin ? Share2 : BookOpen}
                label={isCoachOrAdmin ? "Shared Playlists" : "My Playlists"}
                isActive={pathname.startsWith("/my-playlists")}
              />
            )}
            {isCoachOrAdmin && (
              <SidebarIconButton
                href="/matches"
                icon={Film}
                label="Library"
                isActive={pathname.startsWith("/matches")}
              />
            )}
            {showOrganization && (
              <SidebarIconButton
                href="/organization"
                icon={Building2}
                label="Organization"
                isActive={pathname.startsWith("/organization")}
              />
            )}
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
                className="h-10 w-10 flex items-center justify-center rounded-lg transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => setFeedbackOpen(true)}
              >
                <MessageSquarePlus className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Send feedback</TooltipContent>
          </Tooltip>
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
          <SidebarIconButton
            href="/settings"
            icon={Settings}
            label="Settings"
            isActive={pathname === "/settings"}
          />
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
      </div>

      <ReportProblemDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </aside>
  );
}
