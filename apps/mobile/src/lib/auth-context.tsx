/**
 * Port of apps/web/src/components/auth-context.tsx for React Native.
 * Deltas from web: AsyncStorage instead of localStorage (org resolution is
 * async), AppState instead of window focus/visibility, needsOnboarding loaded
 * client-side (web does it in middleware), no Stripe plan polling.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { User } from "@supabase/supabase-js";
import { getMyProfile, getMyOrgs, checkOnboardingNeeded } from "@scoutable/shared/lib/profile-db";
import { sortOrgsClubFirst, isPlayerOnly as derivePlayerOnly } from "@scoutable/shared/lib/orgs";
import type { UserProfile, OrgMembership, OrgPlanTier } from "@scoutable/shared/types/org";
import { supabase } from "./supabase";
import { identifyUser, resetUser, trackEvent } from "./analytics";
import { registerForPush } from "./notifications";
import { touchThisDevice } from "./device-registry";

const ACTIVE_ORG_KEY = "scoutable_active_org_id";

/** Skip the foreground-triggered refetch if the org snapshot is younger than this. */
const FOCUS_REFRESH_MIN_MS = 30_000;

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  myOrgs: OrgMembership[];
  /** null = not yet known (still loading). */
  needsOnboarding: boolean | null;
  activeOrgId: string | null;
  activeOrg: OrgMembership | null;
  activeOrgRole: OrgMembership["role"] | null;
  activeOrgPlan: OrgPlanTier;
  activeOrgIsPersonal: boolean;
  /**
   * True when the user's only club-org roles are `player` (and they belong
   * to at least one club org). Player-only users get the two-destination
   * nav (My Playlists / My Highlights) instead of the space switcher —
   * tenancy is a coach/admin concept.
   */
  isPlayerOnly: boolean;
  setActiveOrg: (orgId: string) => void;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
  profileLoading: true,
  myOrgs: [],
  needsOnboarding: null,
  activeOrgId: null,
  activeOrg: null,
  activeOrgRole: null,
  activeOrgPlan: "free",
  activeOrgIsPersonal: false,
  isPlayerOnly: false,
  setActiveOrg: () => {},
  reloadProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [myOrgs, setMyOrgs] = useState<OrgMembership[]>([]);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);

  // Refs mirror state so effect-scoped listeners never read stale closures.
  const userRef = useRef<User | null>(null);
  const lastLoadedAtRef = useRef(0);

  async function resolveActiveOrg(orgs: OrgMembership[]): Promise<string | null> {
    if (orgs.length === 0) return null;
    const stored = await AsyncStorage.getItem(ACTIVE_ORG_KEY).catch(() => null);
    if (stored && orgs.some((o) => o.orgId === stored)) return stored;
    return orgs[0].orgId;
  }

  const setActiveOrg = useCallback((orgId: string) => {
    AsyncStorage.setItem(ACTIVE_ORG_KEY, orgId).catch(() => {});
    setActiveOrgIdState(orgId);
  }, []);

  /**
   * Silent loads (foreground refetch) don't toggle profileLoading — they'd
   * flash loading UI — and keep the current snapshot on failure rather than
   * wiping the session over a transient network error.
   */
  async function loadProfile(userId: string, opts?: { silent?: boolean }): Promise<void> {
    if (!opts?.silent) setProfileLoading(true);
    lastLoadedAtRef.current = Date.now();
    try {
      const [p, rawOrgs, onboarding] = await Promise.all([
        getMyProfile(supabase, userId),
        getMyOrgs(supabase),
        checkOnboardingNeeded(supabase),
      ]);
      // Without a stored choice resolveActiveOrg falls back to orgs[0] — a
      // club space is always the more useful default than the personal one.
      const orgs = sortOrgsClubFirst(rawOrgs);
      const resolved = await resolveActiveOrg(orgs);
      setProfile(p);
      setMyOrgs(orgs);
      setNeedsOnboarding(onboarding);
      setActiveOrgIdState(resolved);
      // Merge profile-level traits once loaded (role isn't known at SIGNED_IN
      // time) — mirrors the web/desktop two-stage identify.
      if (!opts?.silent) {
        identifyUser(userId, {
          declared_role: p?.declaredRole,
          plan_tier: orgs.find((o) => o.isPersonal)?.planTier,
        });
      }
    } catch (err) {
      console.error("[auth] loadProfile failed:", err);
      if (!opts?.silent) {
        setProfile(null);
        setMyOrgs([]);
        setNeedsOnboarding(null);
        setActiveOrgIdState(null);
      }
    } finally {
      if (!opts?.silent) setProfileLoading(false);
    }
  }

  // Returning to the foreground is the cue that something (a new share, a
  // change on another device) may have happened while we were away.
  // Throttled so quick app-switches don't refetch.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const u = userRef.current;
      if (!u) return;
      if (Date.now() - lastLoadedAtRef.current < FOCUS_REFRESH_MIN_MS) return;
      loadProfile(u.id, { silent: true });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      userRef.current = session?.user ?? null;

      if (session?.user && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        if (event === "SIGNED_IN") {
          identifyUser(session.user.id, { email: session.user.email });
          trackEvent("signed_in");
        }
        // Silent and permission-gated (never prompts); the upsert also
        // reassigns a shared device's token to this user.
        registerForPush(supabase);
        void touchThisDevice(supabase);
        loadProfile(session.user.id);
      } else if (event === "SIGNED_OUT" || (!session?.user && event === "INITIAL_SESSION")) {
        if (event === "SIGNED_OUT") {
          trackEvent("signed_out");
          resetUser();
        }
        setProfile(null);
        setMyOrgs([]);
        setNeedsOnboarding(null);
        setActiveOrgIdState(null);
        setProfileLoading(false);
      }

      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const activeOrg = myOrgs.find((o) => o.orgId === activeOrgId) ?? myOrgs[0] ?? null;
  const activeOrgRole = activeOrg?.role ?? null;
  const activeOrgPlan: OrgPlanTier = activeOrg?.planTier ?? "free";
  const activeOrgIsPersonal = activeOrg?.isPersonal ?? false;
  const isPlayerOnly = derivePlayerOnly(myOrgs);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        profile,
        profileLoading,
        myOrgs,
        needsOnboarding,
        activeOrgId,
        activeOrg,
        activeOrgRole,
        activeOrgPlan,
        activeOrgIsPersonal,
        isPlayerOnly,
        setActiveOrg,
        reloadProfile: async () => {
          if (userRef.current) await loadProfile(userRef.current.id);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
