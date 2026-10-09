/**
 * Permission priming for push notifications: the OS prompt is one-shot, so
 * it's never fired at launch — only from here, after the user has a feed
 * with real content (they know what a notification would be FOR).
 * Standard priming pattern; dismissal is permanent (AsyncStorage) and the
 * card never returns once permission is decided either way.
 */
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Group";
import { Text } from "@/components/ui/Text";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Device from "expo-device";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth-context";
import {
  getPermissionState,
  registerForPush,
  requestPushPermission,
} from "@/lib/notifications";

const DISMISSED_KEY = "scoutable_notification_primer_dismissed";

export function NotificationPrimer() {
  const { activeOrgRole } = useAuth();
  const isCoachOrAdmin = activeOrgRole === "coach" || activeOrgRole === "admin";
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Device.isDevice) return;
      const dismissed = await AsyncStorage.getItem(DISMISSED_KEY).catch(() => null);
      if (dismissed) return;
      const perm = await getPermissionState();
      // Only prime while the OS prompt is still available to us.
      if (perm.status !== "undetermined" && !perm.canAskAgain) return;
      if (perm.status === "granted") return;
      if (!cancelled) {
        setVisible(true);
        trackEvent("notification_prompt_shown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    AsyncStorage.setItem(DISMISSED_KEY, "1").catch(() => {});
  }, []);

  const enable = useCallback(async () => {
    const granted = await requestPushPermission();
    if (granted) {
      trackEvent("notification_permission_granted");
      registerForPush();
      setVisible(false);
    } else {
      trackEvent("notification_permission_denied");
      dismiss();
    }
  }, [dismiss]);

  if (!visible) return null;

  return (
    <Callout icon="bell">
      <Text variant="callout" className="font-semibold">
        Know when new clips land
      </Text>
      <Text variant="callout" className="text-muted-foreground">
        {isCoachOrAdmin
          ? "Get a notification when someone shares a playlist with you."
          : "Get a notification when your coach shares a playlist with you."}
      </Text>
      <View className="mt-2.5 flex-row items-center gap-2">
        <Button size="sm" onPress={enable}>
          Turn on notifications
        </Button>
        <Button size="sm" variant="ghost" onPress={dismiss}>
          Not now
        </Button>
      </View>
    </Callout>
  );
}
