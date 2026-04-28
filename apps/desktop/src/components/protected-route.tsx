import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";

const PLAYER_BLOCKED_PATHS = ["/matches", "/upload", "/playlists"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, profile, profileLoading, secondaryOrgs } = useAuth();
  const { pathname } = useLocation();

  if (loading || (user && profileLoading)) {
    return <div className="py-24 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!user) return <Navigate to="/auth/login" replace />;

  const needsOnboarding = profile && !profile.isPlatformAdmin && profile.orgId === null && secondaryOrgs.length === 0;

  // Authenticated but no org → onboarding
  if (needsOnboarding && pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  // Already in an org and trying to hit onboarding → home
  if (profile && !needsOnboarding && pathname === "/onboarding") {
    return <Navigate to="/" replace />;
  }

  // Players cannot access Library, Upload, or the playlist editor
  if (profile?.role === "player" && PLAYER_BLOCKED_PATHS.some((p) => pathname.startsWith(p))) {
    return <Navigate to="/my-playlists" replace />;
  }

  return <>{children}</>;
}
