import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { Loader2 } from "lucide-react";
import { DeviceGateScreen } from "@/components/device-gate-screen";
import { WorkspaceUnavailableScreen } from "@/components/workspace-unavailable-screen";
import { resolveGateState } from "@scoutable/shared/lib/orgs";

const PLAYER_BLOCKED_PATHS = ["/matches", "/upload", "/playlists"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const {
    user, loading, profile, profileLoading, myOrgs, orgsLoaded,
    activeOrgIsPersonal, activeOrgRole, deviceBlocked,
  } = useAuth();
  const { pathname } = useLocation();

  // Decision lives in packages/shared so the invariant it protects — a
  // signed-in user is never blocked for belonging to no club — is unit
  // tested rather than re-derived here.
  const gate = resolveGateState({
    hasUser: !!user,
    sessionLoading: loading,
    profileLoading,
    hasProfile: !!profile,
    orgsLoaded,
    orgCount: myOrgs.length,
    deviceBlocked,
  });

  if (gate === "loading") {
    return (
      <div className="py-24 flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (gate === "login") return <Navigate to="/auth/login" replace />;

  // Both render rather than navigate — every route sits behind
  // ProtectedRoute, so there is nothing to escape to.
  if (gate === "device-blocked") return <DeviceGateScreen />;
  if (gate === "unavailable") return <WorkspaceUnavailableScreen />;

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
