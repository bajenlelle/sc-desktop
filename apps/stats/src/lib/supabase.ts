import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createSupabaseClient } from "@scoutable/shared/lib/supabase";

// Same project and conventions as apps/mobile (AsyncStorage, not SecureStore:
// SecureStore truncates values over ~2KB on Android, which corrupts sessions).
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
  },
);

AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
