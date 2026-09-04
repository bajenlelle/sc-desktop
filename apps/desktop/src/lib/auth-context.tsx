import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { identifyUser, resetUser, trackEvent } from "@/lib/analytics";
import { getMyProfile, getMyOrgs } from "@/lib/profile-db";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import { touchThisDevice } from "@/lib/device-registry";
import { seedDemoMatch } from "@/lib/matches-db";
import type { UserProfile, OrgMembership, OrgPlanTier } from "@/types/org";

const ACTIVE_ORG_KEY = "scoutable_active_org_id";

/** Skip the focus-triggered refetch if the org snapshot is younger than this. */
const FOCUS_REFRESH_MIN_MS = 30_000;
/** How the post-upgrade poll paces itself: every 3s, give up after 60s. */
const PLAN_POLL_INTERVAL_MS = 3_000;
const PLAN_POLL_TIMEOUT_MS = 60_000;

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  myOrgs: OrgMembership[];
  /** @deprecated Use myOrgs */
  secondaryOrgs: OrgMembership[];
  activeOrgId: string | null;
  activeOrg: OrgMembership | null;
  activeOrgRole: OrgMembership['role'] | null;
  activeOrgPlan: OrgPlanTier;
  activeOrgIsPersonal: boolean;
  /**
   * Staff in a club space — the single gate for org-management entry points
   * (space menu, Settings card, Go menu, invite shortcut). Players and
   * personal spaces are excluded.
   */
  activeOrgCanManage: boolean;
  setActiveOrg: (orgId: string) => void;
  reloadProfile: () => Promise<void>;
  /**
   * Call when the user is sent off to Stripe (checkout or billing portal).
   * The plan-tier write happens via an async webhook, so this polls the org
   * snapshot until the active org's tier changes or a timeout passes —
   * without it, quota/export gating stays on the old plan until app restart.
   */
  expectPlanChange: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
  profileLoading: true,
  myOrgs: [],
  secondaryOrgs: [],
  activeOrgId: null,
  activeOrg: null,
  activeOrgRole: null,
  activeOrgPlan: 'free',
  activeOrgIsPersonal: false,
  activeOrgCanManage: false,
  setActiveOrg: () => {},
  reloadProfile: async () => {},
  expectPlanChange: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [myOrgs, setMyOrgs] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);

  // Refs mirror state so effect-scoped listeners and the poll never read
  // stale closures.
  const userRef = useRef<User | null>(null);
  const lastLoadedAtRef = useRef(0);
  /** User whose profile boot already ran — dedupes focus-triggered SIGNED_IN re-emits. */
  const bootedUserIdRef = useRef<string | null>(null);
  const planPollRef = useRef<number | null>(null);
  const activeOrgSnapshotRef = useRef<{ orgId: string; planTier: OrgPlanTier } | null>(null);

  function resolveActiveOrg(orgs: OrgMembership[]): string | null {
    if (orgs.length === 0) return null;
    const stored = localStorage.getItem(ACTIVE_ORG_KEY);
    if (stored && orgs.some((o) => o.orgId === stored)) return stored;
    return orgs[0].orgId;
  }

  const setActiveOrg = useCallback((orgId: string) => {
    localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    setActiveOrgIdState(orgId);
  }, []);

  /**
   * Silent loads (focus refetch, upgrade poll) don't toggle profileLoading —
   * they'd flash loading UI — and keep the current snapshot on failure rather
   * than wiping the session over a transient network error.
   */
  async function loadProfile(userId: string, opts?: { silent?: boolean }): Promise<OrgMembership[] | null> {
    if (!opts?.silent) setProfileLoading(true);
    lastLoadedAtRef.current = Date.now();
    try {
      const [p, rawOrgs] = await Promise.all([getMyProfile(userId), getMyOrgs()]);
      // Belt-and-braces over the RPC's ORDER BY (see shared/lib/orgs.ts):
      // the orgs[0] fallback must land on a club, not the personal org.
      const orgs = sortOrgsClubFirst(rawOrgs);
      setProfile(p);
      setMyOrgs(orgs);
      setActiveOrgIdState(resolveActiveOrg(orgs));
      if (!opts?.silent) {
        maybeSeedDemo(userId, orgs);
        // Role isn't known at the SIGNED_IN identify (profile not loaded
        // yet) — merge it in once it is, so PostHog can segment by persona.
        if (p.declaredRole) {
          identifyUser(userId, { declared_role: p.declaredRole });
        }
      }
      return orgs;
    } catch (err) {
      console.error("[auth] loadProfile failed:", err);
      if (!opts?.silent) {
        setProfile(null);
        setMyOrgs([]);
        setActiveOrgIdState(null);
      }
      return null;
    } finally {
      if (!opts?.silent) setProfileLoading(false);
    }
  }

  /**
   * Seed the sample game into a brand-new user's personal org so they can
   * try clips → playlists with zero footage. Fire-and-forget off the login
   * path, once per app start. The RPC is idempotent server-side (once per
   * user, ever) and cheaply no-ops until a demo template is configured — so
   * a user who signed up before the template existed still gets seeded on a
   * later launch. No client-side guard: it must not block that catch-up.
   */
  function maybeSeedDemo(_userId: string, orgs: OrgMembership[]) {
    const personal = orgs.find((o) => o.isPersonal);
    if (!personal) return;
    seedDemoMatch(personal.orgId)
      .then((matchId) => {
        if (matchId) {
          trackEvent("demo_game_seeded");
          // Library/playlists may already be mounted before the copy lands.
          window.dispatchEvent(new CustomEvent("demo-seeded"));
        }
      })
      .catch((err) => console.error("[auth] demo seeding failed:", err));
  }

  const stopPlanPoll = useCallback(() => {
    if (planPollRef.current !== null) {
      window.clearInterval(planPollRef.current);
      planPollRef.current = null;
    }
  }, []);

  const expectPlanChange = useCallback(() => {
    const u = userRef.current;
    if (!u) return;
    const baseline = activeOrgSnapshotRef.current;
    stopPlanPoll();
    const deadline = Date.now() + PLAN_POLL_TIMEOUT_MS;
    planPollRef.current = window.setInterval(async () => {
      if (Date.now() > deadline || userRef.current?.id !== u.id) {
        stopPlanPoll();
        return;
      }
      const orgs = await loadProfile(u.id, { silent: true });
      if (!orgs) return;
      const org = baseline ? orgs.find((o) => o.orgId === baseline.orgId) : orgs[0];
      if (org && org.planTier !== (baseline?.planTier ?? "free")) stopPlanPoll();
    }, PLAN_POLL_INTERVAL_MS);
  }, [stopPlanPoll]);

  // Returning to the app is the cue that something (an upgrade, a change on
  // another device) may have happened while we were away. Throttled so plain
  // alt-tabbing doesn't refetch.
  useEffect(() => {
    const maybeRefresh = () => {
      const u = userRef.current;
      if (!u) return;
      if (Date.now() - lastLoadedAtRef.current < FOCUS_REFRESH_MIN_MS) return;
      loadProfile(u.id, { silent: true });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => stopPlanPoll, [stopPlanPoll]);

  useEffect(() => {
    const supabase = createClient();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      userRef.current = session?.user ?? null;

      if (session?.user && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        // supabase-js re-emits SIGNED_IN whenever it revalidates the session
        // on window focus (macOS fullscreen transitions focus the window
        // too). Re-booting there flips profileLoading, which unmounts every
        // page behind ProtectedRoute and wipes in-page state (open playlist,
        // playback, fullscreen). Boot once per user; the throttled focus
        // listener above already owns silent freshness after that.
        if (bootedUserIdRef.current === session.user.id) {
          setLoading(false);
          return;
        }
        bootedUserIdRef.current = session.user.id;
        if (event === "SIGNED_IN") {
          identifyUser(session.user.id, { email: session.user.email });
          trackEvent("signed_in");
        }
        touchThisDevice();
        loadProfile(session.user.id);
      } else if (event === "SIGNED_OUT" || (!session?.user && event === "INITIAL_SESSION")) {
        bootedUserIdRef.current = null;
        if (event === "SIGNED_OUT") {
          trackEvent("signed_out");
          resetUser();
        }
        stopPlanPoll();
        setProfile(null);
        setMyOrgs([]);
        setActiveOrgIdState(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const activeOrg = myOrgs.find((o) => o.orgId === activeOrgId) ?? myOrgs[0] ?? null;
  const activeOrgRole = activeOrg?.role ?? null;
  const activeOrgPlan: OrgPlanTier = activeOrg?.planTier ?? 'free';
  const activeOrgIsPersonal = activeOrg?.isPersonal ?? false;
  const activeOrgCanManage =
    !activeOrgIsPersonal && (activeOrgRole === 'coach' || activeOrgRole === 'admin');

  // expectPlanChange's baseline: whatever org/tier the user was on when they
  // clicked upgrade.
  activeOrgSnapshotRef.current = activeOrg
    ? { orgId: activeOrg.orgId, planTier: activeOrg.planTier }
    : null;

  // loadProfile is redeclared every render, so route reloadProfile through a
  // ref to keep it stable — otherwise the memo below would be defeated by a
  // fresh closure on every render. Synced in an effect rather than during
  // render (refs must not be written while rendering); the initial value
  // already covers any call made before the first flush.
  const loadProfileRef = useRef(loadProfile);
  useEffect(() => {
    loadProfileRef.current = loadProfile;
  });
  const reloadProfile = useCallback(async () => {
    const u = userRef.current;
    if (u) await loadProfileRef.current(u.id);
  }, []);

  // Memoized because every consumer in the app re-renders when this object's
  // identity changes. The focus/visibility refresh calls setMyOrgs with a
  // fresh array every 30s, which previously re-rendered the entire tree —
  // including the playlists sidebar and its per-row work.
  const value = useMemo(
    () => ({
      user, loading, profile, profileLoading,
      myOrgs, secondaryOrgs: myOrgs,
      activeOrgId, activeOrg, activeOrgRole, activeOrgPlan, activeOrgIsPersonal,
      activeOrgCanManage, setActiveOrg,
      reloadProfile,
      expectPlanChange,
    }),
    [
      user, loading, profile, profileLoading, myOrgs,
      activeOrgId, activeOrg, activeOrgRole, activeOrgPlan, activeOrgIsPersonal,
      activeOrgCanManage, setActiveOrg, reloadProfile, expectPlanChange,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
