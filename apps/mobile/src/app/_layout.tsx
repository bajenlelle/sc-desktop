// Before anything that might create a client: dev-only read-only mode.
import "@/lib/dev-read-only";
import "../global.css";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Sentry from "@sentry/react-native";
import { setDbErrorReporter } from "@scoutable/shared/lib/report";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { INTER_FONTS, interStyle, setInterLoaded } from "@/lib/fonts";
import { AuthProvider } from "@/lib/auth-context";
import { MobileThemeProvider, useAppTheme, useThemeColors } from "@/lib/theme-context";
import { ThemeSync } from "@/components/ThemeSync";
import { Icon } from "@/components/ui/Icon";
import { SheetHost } from "@/components/ui/Sheet";
import { ToastHost } from "@/components/ui/Toast";
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

// The splash stays up until Inter is loaded, so no screen draws in the system
// font first and then jumps.
SplashScreen.preventAutoHideAsync().catch(() => {});

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
/** The error screen's button, in plain styles (see ErrorBoundary). */
function RetryButton({ onPress, background, color }: { onPress: () => void; background: string; color: string }) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        marginTop: 24,
        width: "100%",
        height: 44,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
        opacity: pressed ? 0.9 : 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      }}
    >
      <Text style={[{ fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color }, interStyle(600)]}>Try again</Text>
    </Pressable>
  );
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const colors = themeColors(scheme);

  // Render errors bypass Sentry's global handlers, so report explicitly.
  Sentry.captureException(error);

  // The app's StatusScreen look, in plain styles: this renders in place of the
  // root layout, outside the theme provider that NativeWind's tokens need.
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background }}>
      <View style={{ width: "100%", maxWidth: 440, alignItems: "center" }}>
        <View style={{ marginBottom: 12 }}>
          <Icon name="error" size={28} color={colors.mutedForeground} />
        </View>
        <Text
          accessibilityRole="header"
          style={[{ fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.4, color: colors.foreground, textAlign: "center" }, interStyle(600)]}
        >
          Something went wrong
        </Text>
        <Text style={[{ marginTop: 6, fontSize: 15, lineHeight: 20, letterSpacing: -0.1, color: colors.mutedForeground, textAlign: "center" }, interStyle(400)]}>
          The error has been reported automatically. Tap below to try again.
        </Text>
        <RetryButton onPress={retry} background={colors.primary} color={colors.primaryForeground} />
      </View>
    </View>
  );
}

/** Mobile twin of web's PostHogProvider pageview effect. */
function PageTracker() {
  const pathname = usePathname();
  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    if (pathname === lastRef.current) return;
    lastRef.current = pathname;
    trackEvent("page_viewed", { path: pathname });
  }, [pathname]);
  return null;
}

/**
 * Inside MobileThemeProvider so navigator chrome follows the active theme;
 * StatusBar style="auto" tracks Appearance, which the provider's
 * colorScheme.set drives.
 */
function ThemedShell() {
  const colors = useThemeColors();
  const { resolvedMode } = useAppTheme();
  // Native bars (headers, tabs, back buttons) take their colours from the
  // navigation theme, so they follow the eight colour themes like the rest.
  const navTheme = useMemo(() => {
    const base = resolvedMode === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: resolvedMode === "dark",
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.background,
        text: colors.foreground,
        border: colors.separator,
        notification: colors.destructive,
      },
    };
  }, [colors, resolvedMode]);
  return (
    <ThemeProvider value={navTheme}>
      <PageTracker />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(INTER_FONTS);
  const fontsSettled = fontsLoaded || fontError != null;
  // Set before the first screen renders; without the files the app keeps the
  // system font rather than not starting.
  if (fontsSettled) setInterLoaded(fontsLoaded);
  useEffect(() => {
    if (!fontsSettled) return;
    if (fontError) Sentry.captureException(fontError);
    SplashScreen.hideAsync().catch(() => {});
  }, [fontsSettled, fontError]);

  useEffect(() => {
    trackEvent("app_started");
    // Portrait everywhere; the player's fullscreen unlocks rotation while it
    // is open. (The iOS plugin sets the same lock before launch.)
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  if (!fontsSettled) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <MobileThemeProvider>
            <ThemeSync />
            {/* Sheets and toasts render above every screen, signed in or out
                (the sign-up role picker opens a menu sheet under large text). */}
            <ToastHost>
              <SheetHost>
                <ThemedShell />
              </SheetHost>
            </ToastHost>
          </MobileThemeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
