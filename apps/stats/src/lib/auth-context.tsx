/**
 * Auth for the stat keeper: a signed-in Scoutable account and its profile
 * (the display name becomes the keeper label on published sessions). No org
 * or team logic — sessions are owned by the user, and the desktop import
 * decides which space a game lands in.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getMyProfile } from "@scoutable/shared/lib/profile-db";
import type { UserProfile } from "@scoutable/shared/types/org";
import { supabase } from "./supabase";
import { identifyUser, resetUser, trackEvent } from "./analytics";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  profile: UserProfile | null;
  /** What published sessions show as the keeper; "Anonymous keeper" until a name exists. */
  keeperLabel: string;
  reloadProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
  keeperLabel: "Anonymous keeper",
  reloadProfile: async () => {},
  signOut: async () => {},
});

/** "Anna Lindqvist" → "Anna L."; a bare first name stays as is. */
export function keeperLabelFor(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Anonymous keeper";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const userRef = useRef<User | null>(null);

  async function loadProfile(userId: string) {
    try {
      const p = await getMyProfile(supabase, userId);
      setProfile(p);
    } catch (err) {
      console.error("[auth] loadProfile failed:", err);
      setProfile(null);
    }
  }

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      userRef.current = session?.user ?? null;
      if (session?.user && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        if (event === "SIGNED_IN") {
          identifyUser(session.user.id, { email: session.user.email });
          trackEvent("signed_in");
        }
        void loadProfile(session.user.id);
      } else if (event === "SIGNED_OUT" || (!session?.user && event === "INITIAL_SESSION")) {
        if (event === "SIGNED_OUT") {
          trackEvent("signed_out");
          resetUser();
        }
        setProfile(null);
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
        keeperLabel: keeperLabelFor(profile?.fullName),
        reloadProfile: async () => {
          if (userRef.current) await loadProfile(userRef.current.id);
        },
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
