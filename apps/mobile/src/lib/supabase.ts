// First: the dev-only read-only mode has to wrap fetch before the client
// below captures it (no-op outside __DEV__ with EXPO_PUBLIC_READ_ONLY=1).
import "@/lib/dev-read-only";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createSupabaseClient } from "@scoutable/shared/lib/supabase";

// AsyncStorage, not SecureStore: SecureStore truncates values over ~2KB on
// Android, which corrupts Supabase JWT sessions.
export const supabase = createSupabaseClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  }
);

// Token auto-refresh only runs while the app is foregrounded (Supabase RN pattern).
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
