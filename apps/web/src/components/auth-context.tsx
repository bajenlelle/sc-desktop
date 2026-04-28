"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getMyProfile, getMySecondaryOrgs } from "@/lib/profile-db";
import type { UserProfile, SecondaryOrg } from "@scoutable/shared/types/org";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  secondaryOrgs: SecondaryOrg[];
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
  profileLoading: true,
  secondaryOrgs: [],
  reloadProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [secondaryOrgs, setSecondaryOrgs] = useState<SecondaryOrg[]>([]);

  async function loadProfile(userId: string) {
    setProfileLoading(true);
    try {
      const [p, orgs] = await Promise.all([getMyProfile(userId), getMySecondaryOrgs()]);
      setProfile(p);
      setSecondaryOrgs(orgs);
    } catch (err) {
      console.error("[auth] loadProfile failed:", err);
      setProfile(null);
      setSecondaryOrgs([]);
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);

      if (session?.user && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        loadProfile(session.user.id);
      } else if (event === "SIGNED_OUT" || (!session?.user && event === "INITIAL_SESSION")) {
        setProfile(null);
        setSecondaryOrgs([]);
        setProfileLoading(false);
      }

      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        profile,
        profileLoading,
        secondaryOrgs,
        reloadProfile: () => (user ? loadProfile(user.id) : Promise.resolve()),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
