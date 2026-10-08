import { motion } from "framer-motion";
import { Link, useLocation } from "react-router-dom";
import { BookOpen, Film, Home, ListVideo, Share2 } from "lucide-react";
import { UpdateCard } from "@/components/UpdateChecker";
import { useAuth } from "@/lib/auth-context";
import { useImportQuota } from "@/lib/use-import-quota";
import { IS_MACOS } from "@/lib/platform";
import { springs, useReducedMotionSafe } from "@/lib/motion";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { cn } from "@/lib/utils";
import { SpaceSwitcher } from "./space-switcher";
import { UserMenu } from "./user-menu";

/** Keep in step with --sidebar-width in index.css. */
const SIDEBAR_WIDTH = 220;

function NavItem({
  to,
  icon: Icon,
  label,
  active,
  onClickWhileActive,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClickWhileActive?: () => void;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (active && onClickWhileActive) {
          e.preventDefault();
          onClickWhileActive();
        }
      }}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-sm font-medium outline-none transition-[background-color,transform] duration-100 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-selection",
        active
          ? "bg-selection text-selection-foreground"
          : "text-foreground hover:bg-fill-1 active:bg-fill-2",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-selection-foreground" : "text-primary")} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * The macOS source list: labelled rows, the space at the top, the account
 * at the bottom, the traffic lights inset in the strip above it all. On
 * macOS the system paints vibrancy behind it; on Windows it is an opaque
 * column with a separator. Collapsing animates the width with a spring.
 */
export function Sidebar() {
  const {
    user,
    profileLoading,
    myOrgs,
    activeOrg,
    activeOrgRole,
    activeOrgIsPersonal,
    setActiveOrg,
  } = useAuth();
  const { pathname } = useLocation();
  const collapsed = useSidebarCollapsed();
  const reduced = useReducedMotionSafe();
  const importQuota = useImportQuota();

  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const ready = !!user && !profileLoading;

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 0 : SIDEBAR_WIDTH }}
      transition={reduced ? { duration: 0 } : springs.standard}
      aria-hidden={collapsed || undefined}
      className={cn(
        "relative h-screen shrink-0 overflow-hidden",
        IS_MACOS ? "bg-material-sidebar" : "border-r border-separator bg-sidebar",
      )}
    >
      {/* Fixed inner width so the content never reflows while the width springs. */}
      <div className="flex h-full flex-col" style={{ width: SIDEBAR_WIDTH }}>
        <div
          data-tauri-drag-region
          className={cn("shrink-0", IS_MACOS ? "h-[var(--titlebar-inset)]" : "h-3")}
        />

        {ready && activeOrg && (
          <SpaceSwitcher
            org={activeOrg}
            myOrgs={myOrgs}
            setActiveOrg={setActiveOrg}
            importQuota={importQuota}
          />
        )}

        {ready && (
          <nav aria-label="Main" className="mt-3 flex flex-col gap-0.5 px-2">
            {isCoachOrAdmin && (
              <NavItem to="/" icon={Home} label="Home" active={pathname === "/"} />
            )}
            {isCoachOrAdmin && (
              <NavItem
                to="/playlists"
                icon={ListVideo}
                label="Playlists"
                active={pathname.startsWith("/playlists") && !pathname.startsWith("/my-playlists")}
                onClickWhileActive={() => window.dispatchEvent(new CustomEvent("playlist-browser-toggle"))}
              />
            )}
            {!activeOrgIsPersonal && (
              <NavItem
                to="/my-playlists"
                icon={isCoachOrAdmin ? Share2 : BookOpen}
                label={isCoachOrAdmin ? "Shared playlists" : "My playlists"}
                active={pathname.startsWith("/my-playlists")}
              />
            )}
            {isCoachOrAdmin && (
              <NavItem to="/matches" icon={Film} label="Library" active={pathname.startsWith("/matches")} />
            )}
          </nav>
        )}

        <div className="mt-auto flex flex-col gap-2 p-2">
          <UpdateCard />
          {user && <UserMenu user={user} />}
        </div>
      </div>
    </motion.aside>
  );
}
