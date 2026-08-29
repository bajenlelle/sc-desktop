import "../global.css";

import { useEffect } from "react";
import * as Sentry from "@sentry/react-native";
import { setDbErrorReporter } from "@scoutable/shared/lib/report";
import { Stack, usePathname, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import {
  BarlowCondensed_600SemiBold,
  BarlowCondensed_700Bold,
} from "@expo-google-fonts/barlow-condensed";
import { AuthProvider } from "@/lib/auth-context";
import { themeColors } from "@/lib/theme";

// DSNs are public identifiers, not secrets. Dev builds stay offline unless
// EXPO_PUBLIC_SENTRY_DSN is set (e.g. in .env) for testing the pipeline.
const SENTRY_DSN =
  "https://6417d8da6dc3665029430c2c81aebf98@o4511984392994816.ingest.de.sentry.io/4511984556376144";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? (__DEV__ ? undefined : SENTRY_DSN),
  environment: __DEV__ ? "development" : "production",
  sampleRate: 1,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  ignoreErrors: [
    /Network request failed/i,
    /Failed to fetch/i,
    "AbortError",
  ],
});

initAnalytics();

// Surface the shared DB helpers' gracefully-swallowed failures. captureMessage
// with a db_fn tag so Sentry groups per function, not one mega-issue.
setDbErrorReporter((fn, e) => {
  Sentry.captureMessage(`db:${fn}: ${e.message}`, {
    level: "error",
    tags: { db_fn: fn },
  });
});

/**
 * Expo Router convention: exporting ErrorBoundary from the root layout makes
 * it the app-wide render-error screen (replaces the dev-only red screen in
 * production builds).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);

  // Render errors bypass Sentry's global handlers, so report explicitly.
  Sentry.captureException(error);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ fontSize: 18, fontWeight: "600", color: colors.foreground, marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text
        style={{
          fontSize: 14,
          color: colors.mutedForeground,
          textAlign: "center",
          marginBottom: 20,
        }}
      >
        The error has been reported automatically. Tap below to try again.
      </Text>
      <Pressable
        onPress={retry}
        style={{
          backgroundColor: colors.primary,
          borderRadius: 8,
          paddingHorizontal: 20,
          paddingVertical: 10,
        }}
      >
        <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** Mobile twin of web's PostHogProvider pageview effect. */
function PageTracker() {
  const pathname = usePathname();
  useEffect(() => {
    trackEvent("page_viewed", { path: pathname });
  }, [pathname]);
  return null;
}

function RootLayout() {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);

  useEffect(() => {
    trackEvent("app_started");
  }, []);

  // Fonts load async; rendering with system fallbacks until then beats a blank screen.
  useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PageTracker />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        <StatusBar style="auto" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(RootLayout);
