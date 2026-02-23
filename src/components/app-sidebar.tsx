import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import {
  Activity,
  Trophy,
  ListVideo,
  Plus,
  Settings,
  Sun,
  Moon,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@supabase/supabase-js";

const navItems = [
  { label: "Sessions", href: "/matches", icon: Trophy },
  { label: "Playlists", href: "/playlists", icon: ListVideo },
];

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
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isActive?: boolean;
  className?: string;
}) {
  return (
    <Link to={href} title={label}>
      <div
        className={cn(
          "h-10 w-10 flex items-center justify-center rounded-lg transition-colors",
          isActive
            ? "bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400"
            : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100",
          className
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
    </Link>
  );
}

export function AppSidebar() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    navigate("/auth/login");
  }

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 h-screen">
      {/* Logo */}
      <div className="flex h-14 items-center justify-center border-b border-slate-200 dark:border-slate-800">
        <Link to="/">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
            <Activity className="h-4 w-4 text-white" />
          </div>
        </Link>
      </div>

      {/* Nav items */}
      {user && (
        <nav className="flex flex-col items-center gap-1 py-3">
          {navItems.map((item) => (
            <SidebarIconButton
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              isActive={pathname.startsWith(item.href)}
            />
          ))}
        </nav>
      )}

      {/* Bottom utilities */}
      <div className="mt-auto flex flex-col items-center gap-1 border-t border-slate-200 dark:border-slate-800 py-3">
        {user && (
          <SidebarIconButton
            href="/upload"
            icon={Plus}
            label="New Session"
            isActive={pathname === "/upload"}
            className="text-indigo-600 dark:text-indigo-400"
          />
        )}
        {user && (
          <SidebarIconButton
            href="/settings"
            icon={Settings}
            label="Settings"
            isActive={pathname === "/settings"}
          />
        )}
        <button
          type="button"
          title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          className="relative h-10 w-10 flex items-center justify-center rounded-lg transition-colors text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
        </button>
        {user && (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900 text-xs font-semibold text-indigo-700 dark:text-indigo-300"
            title={user.email}
          >
            {getInitials(user)}
          </div>
        )}
        {user && (
          <button
            type="button"
            title="Sign out"
            className="h-10 w-10 flex items-center justify-center rounded-lg transition-colors text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
            onClick={handleSignOut}
          >
            <LogOut className="h-5 w-5" />
          </button>
        )}
      </div>
    </aside>
  );
}
