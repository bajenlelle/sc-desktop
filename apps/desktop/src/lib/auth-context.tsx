import { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { identifyUser, resetUser, trackEvent } from "@/lib/analytics";
import { getMyProfile } from "@/lib/profile-db";
import type { UserProfile } from "@/types/org";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
  profileLoading: true,
  reloadProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  async function loadProfile(userId: string) {
    setProfileLoading(true);
    try {
      const p = await getMyProfile(userId);
      setProfile(p);
    } catch (err) {
      console.error("[auth] loadProfile failed:", err);
      setProfile(null);
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
        setProfileLoading(false);
      }

      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, profile, profileLoading, reloadProfile: () => user ? loadProfile(user.id) : Promise.resolve() }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
