import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";
import { DeviceGateScreen } from "@/components/device-gate-screen";

const PLAYER_BLOCKED_PATHS = ["/matches", "/upload", "/playlists"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, myOrgs, activeOrgIsPersonal, activeOrgRole, deviceBlocked } = useAuth();
  const { pathname } = useLocation();

  if (loading || (user && profileLoading)) {
    return (
      <div className="py-24 flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/auth/login" replace />;

  // Device hard cap (dark-launched): render, don't navigate — every route
  // sits behind ProtectedRoute, so there is nothing to escape to.
  if (deviceBlocked) return <DeviceGateScreen />;

  const needsOnboarding = profile && !profile.isPlatformAdmin && myOrgs.length === 0;

  // Authenticated but no org → onboarding
  if (needsOnboarding && pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  // Already in an org and trying to hit onboarding → home
  if (profile && !needsOnboarding && pathname === "/onboarding") {
    return <Navigate to="/" replace />;
  }

  // Builder pages are gated by the ACTIVE space's membership role — not the
  // vestigial profiles.role, which is 'coach' by default for everyone and
  // 'player' only on some legacy accounts. In their personal space everyone
  // builds (players make their own tapes); in a club space players belong on
  // their playlist feed. Matches the per-page canAccess checks.
  const canBuild = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  if (!canBuild && PLAYER_BLOCKED_PATHS.some((p) => pathname.startsWith(p))) {
    return <Navigate to="/my-playlists" replace />;
  }

  return <>{children}</>;
}
