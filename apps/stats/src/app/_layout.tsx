import "../global.css";

import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import { setDbErrorReporter } from "@scoutable/shared/lib/report";
import { Stack, usePathname, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { AuthProvider } from "@/lib/auth-context";
import { MobileThemeProvider, useThemeColors } from "@/lib/theme-context";
import { themeColors } from "@/lib/theme";

// No hardcoded DSN yet: create a `scoutable-stats` Sentry project before the
// first TestFlight build and set EXPO_PUBLIC_SENTRY_DSN in the EAS profile.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? "development" : "production"),
  sampleRate: 1,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  ignoreErrors: [/Network request failed/i, /Failed to fetch/i, "AbortError"],
});

initAnalytics();

setDbErrorReporter((fn, e) => {
  Sentry.captureMessage(`db:${fn}: ${e.message}`, { level: "error", tags: { db_fn: fn } });
});

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);
  Sentry.captureException(error);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background }}>
      <Text style={{ fontSize: 18, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>Something went wrong</Text>
      <Text style={{ fontSize: 14, color: colors.mutedForeground, textAlign: "center", marginBottom: 20 }}>
        Your game is saved on this phone. Tap below to try again.
      </Text>
      <Pressable onPress={retry} style={{ backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 }}>
        <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Try again</Text>
      </Pressable>
    </View>
  );
}

function PageTracker() {
  const pathname = usePathname();
  useEffect(() => {
    trackEvent("page_viewed", { path: pathname });
  }, [pathname]);
  return null;
}

function ThemedShell() {
  const colors = useThemeColors();
  return (
    <>
      <PageTracker />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      <StatusBar style="auto" />
    </>
  );
}

function RootLayout() {
  useEffect(() => {
    trackEvent("app_started");
  }, []);
  useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold, BarlowCondensed_600SemiBold, BarlowCondensed_700Bold });
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MobileThemeProvider>
          <ThemedShell />
        </MobileThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
