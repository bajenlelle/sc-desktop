import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { identifyUser, resetUser, trackEvent } from "@/lib/analytics";
import { getMyProfile, getMyOrgs } from "@/lib/profile-db";
import type { UserProfile, OrgMembership, OrgPlanTier } from "@/types/org";

const ACTIVE_ORG_KEY = "scoutable_active_org_id";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  myOrgs: OrgMembership[];
  /** @deprecated Use myOrgs */
  secondaryOrgs: OrgMembership[];
  activeOrgId: string | null;
  activeOrgRole: OrgMembership['role'] | null;
  activeOrgPlan: OrgPlanTier;
  activeOrgIsPersonal: boolean;
  setActiveOrg: (orgId: string) => void;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
  profileLoading: true,
  myOrgs: [],
  secondaryOrgs: [],
  activeOrgId: null,
  activeOrgRole: null,
  activeOrgPlan: 'free',
  activeOrgIsPersonal: false,
  setActiveOrg: () => {},
  reloadProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [myOrgs, setMyOrgs] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);

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

  async function loadProfile(userId: string) {
    setProfileLoading(true);
    try {
      const [p, orgs] = await Promise.all([getMyProfile(userId), getMyOrgs()]);
      setProfile(p);
      setMyOrgs(orgs);
      setActiveOrgIdState(resolveActiveOrg(orgs));
    } catch (err) {
      console.error("[auth] loadProfile failed:", err);
      setProfile(null);
      setMyOrgs([]);
      setActiveOrgIdState(null);
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);

      if (session?.user && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        if (event === "SIGNED_IN") {
          identifyUser(session.user.id, { email: session.user.email });
          trackEvent("signed_in");
        }
        loadProfile(session.user.id);
      } else if (event === "SIGNED_OUT" || (!session?.user && event === "INITIAL_SESSION")) {
        if (event === "SIGNED_OUT") {
          trackEvent("signed_out");
          resetUser();
        }
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

  return (
    <AuthContext.Provider value={{
      user, loading, profile, profileLoading,
      myOrgs, secondaryOrgs: myOrgs,
      activeOrgId, activeOrgRole, activeOrgPlan, activeOrgIsPersonal, setActiveOrg,
      reloadProfile: () => user ? loadProfile(user.id) : Promise.resolve(),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
