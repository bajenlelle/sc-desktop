/**
 * All expo-notifications glue in one module: permission flow, token
 * registration, sign-out ordering, and the app-icon badge.
 *
 * Permission is only ever requested from the primer card
 * (NotificationPrimer) — registerForPush never prompts, so sign-in stays
 * silent for users who haven't opted in.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerPushToken, deletePushToken } from "@scoutable/shared/lib/push-tokens-db";
import { supabase } from "./supabase";

/**
 * Foreground banners are suppressed entirely (v1 simplification): while the
 * app is open, the store refresh + tab badge surface new content within
 * seconds, and a banner over the very screen it links to reads as noise.
 * Route-aware banners ("show unless viewing that playlist") are a possible
 * follow-up.
 */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function getPermissionState(): Promise<Notifications.NotificationPermissionsStatus> {
  return Notifications.getPermissionsAsync();
}

/** allowBadge is load-bearing: the app-icon count needs it on iOS. */
export async function requestPushPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: true },
  });
  return status === "granted";
}

/** Last token we registered from this process — consumed by sign-out cleanup. */
let cachedToken: string | null = null;

/**
 * Registers this device's Expo push token for the signed-in user. Silent and
 * permission-gated — never prompts. Safe to fire-and-forget on every sign-in:
 * the RPC upserts, which is also what reassigns a shared device's token to
 * the new user.
 */
export async function registerForPush(client: SupabaseClient = supabase): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators can't receive push
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    cachedToken = token;
    await registerPushToken(client, token, Platform.OS === "ios" ? "ios" : "android", Device.deviceName);
  } catch {
    // Push registration must never break sign-in.
  }
}

/**
 * Sign-out with token cleanup. SIGNED_OUT fires only after the session is
 * destroyed — at which point RLS blocks the delete — so the token row must go
 * BEFORE supabase.auth.signOut(). Cleanup failures are swallowed (offline
 * sign-out must not hang); the sign-in upsert reassignment and the sender's
 * DeviceNotRegistered pruning are the backstops.
 */
export async function signOutAndCleanup(): Promise<void> {
  try {
    let token = cachedToken;
    if (!token && Device.isDevice) {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === "granted") {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
        token = (await Promise.race([
          Notifications.getExpoPushTokenAsync({ projectId }).then((t) => t.data),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
        ])) as string | null;
      }
    }
    if (token) await deletePushToken(supabase, token);
  } catch {
    // Never block sign-out on cleanup.
  }
  cachedToken = null;
  await syncAppBadge(0);
  await supabase.auth.signOut();
}

/** iOS is the contract; Android home-screen badges are launcher-dependent. */
export async function syncAppBadge(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Badge sync is cosmetic — never surface failures.
  }
}
