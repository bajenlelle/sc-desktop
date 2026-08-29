"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, getMyOrgs } from "@/lib/profile-db";
import type { UserProfile, OrgMembership, OrgPlanTier } from "@scoutable/shared/types/org";
import {
  aliasUser,
  enablePersistentTracking,
  getStashedAttribution,
  identifyUser,
  resetUser,
  trackEvent,
} from "@/lib/analytics";

const ACTIVE_ORG_KEY = "scoutable_active_org_id";

/**
 * Persist the space choice from outside the provider — used by the /join
 * page (public route group, no AuthProvider) so a freshly joined org is the
 * active space after the post-join reload.
 */
export function setStoredActiveOrg(orgId: string) {
  localStorage.setItem(ACTIVE_ORG_KEY, orgId);
}

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
   * True when the user's only club-org roles are `player` (and they belong
   * to at least one club org). Player-only users get the two-destination
   * nav (My Playlists / My Highlights) instead of the space switcher —
   * tenancy is a coach/admin concept.
   */
  isPlayerOnly: boolean;
  setActiveOrg: (orgId: string) => void;
  reloadProfile: () => Promise<void>;
  /**
   * Call when the user is sent off to Stripe (checkout or billing portal).
   * The plan-tier write happens via an async webhook, so this polls the org
   * snapshot until the active org's tier changes or a timeout passes —
   * without it, plan-gated UI stays on the old tier until a full reload.
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
  isPlayerOnly: false,
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
  const planPollRef = useRef<number | null>(null);
  const activeOrgSnapshotRef = useRef<{ orgId: string; planTier: OrgPlanTier } | null>(null);

  function resolveActiveOrg(orgs: OrgMembership[]): string | null {
    if (orgs.length === 0) return null;
    const stored = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_ORG_KEY) : null;
    if (stored && orgs.some((o) => o.orgId === stored)) return stored;
    return orgs[0].orgId;
  }

  const setActiveOrg = useCallback((orgId: string) => {
    setStoredActiveOrg(orgId);
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
      // Club orgs first, stable by name: get_my_orgs() has no ORDER BY, and
      // without a stored choice resolveActiveOrg falls back to orgs[0] — a
      // club space is always the more useful default than the personal one.
      const orgs = [...rawOrgs].sort((a, b) => {
        if (a.isPersonal !== b.isPersonal) return a.isPersonal ? 1 : -1;
        return a.orgName.localeCompare(b.orgName);
      });
      setProfile(p);
      setMyOrgs(orgs);
      setActiveOrgIdState(resolveActiveOrg(orgs));
      // Merge profile-level traits once loaded (role isn't known at SIGNED_IN
      // time) — mirrors the desktop app's two-stage identify.
      if (!opts?.silent) {
        identifyUser(userId, {
          declared_role: p?.declaredRole,
          plan_tier: orgs.find((o) => o.isPersonal)?.planTier,
        });
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

  // Returning to the tab is the cue that something (an upgrade in the Stripe
  // tab, a change on another device) may have happened while we were away.
  // Throttled so plain tab-switching doesn't refetch.
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
        if (event === "SIGNED_IN") {
          enablePersistentTracking();
          identifyUser(session.user.id, { email: session.user.email });
          // Stitch the landing page's anonymous person (?ph_did=) to this
          // user — once; alias is idempotent-ish but no need to repeat.
          const phDid = getStashedAttribution().ph_did;
          if (phDid) aliasUser(phDid);
          trackEvent("signed_in");
        }
        loadProfile(session.user.id);
      } else if (event === "SIGNED_OUT" || (!session?.user && event === "INITIAL_SESSION")) {
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
  const clubOrgs = myOrgs.filter((o) => !o.isPersonal);
  const isPlayerOnly = clubOrgs.length > 0 && clubOrgs.every((o) => o.role === "player");

  // expectPlanChange's baseline: whatever org/tier the user was on when they
  // clicked upgrade.
  activeOrgSnapshotRef.current = activeOrg
    ? { orgId: activeOrg.orgId, planTier: activeOrg.planTier }
    : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        profile,
        profileLoading,
        myOrgs,
        secondaryOrgs: myOrgs,
        activeOrgId,
        activeOrg,
        activeOrgRole,
        activeOrgPlan,
        activeOrgIsPersonal,
        isPlayerOnly,
        setActiveOrg,
        reloadProfile: async () => { if (user) await loadProfile(user.id); },
        expectPlanChange,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
