/**
 * Runtime wiring for push notifications. Renders nothing. Mounted inside
 * PlaylistsProvider in (app)/_layout.tsx, i.e. only while signed in — which
 * also makes it the cold-start bridge: a notification tapped while signed out
 * (or before auth settled) is picked up by getLastNotificationResponseAsync
 * the moment the signed-in tree mounts, so no separate pending-stash is
 * needed. The module-level handled-set stops a response from routing twice
 * across remounts.
 */
import { useEffect, useRef } from "react";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { usePlaylists } from "@/lib/playlists-store";
import { trackEvent } from "@/lib/analytics";
import { configureNotificationHandler } from "@/lib/notifications";

const handledResponses = new Set<string>();

export function NotificationsBridge() {
  const { refresh } = usePlaylists();
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    configureNotificationHandler();

    const route = (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (handledResponses.has(id)) return;
      handledResponses.add(id);
      const data = response.notification.request.content.data as
        | { type?: string; playlistId?: string }
        | undefined;
      trackEvent("notification_opened", { type: data?.type ?? "unknown" });
      // The tapped content may be newer than the mounted store snapshot.
      refreshRef.current().catch(() => {});
      if (typeof data?.playlistId === "string") {
        router.push(`/playlists/${data.playlistId}`);
      } else {
        router.navigate("/playlists");
      }
    };

    // Cold start: the response that launched (or resumed) the app.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) route(response);
    });
    const responseSub = Notifications.addNotificationResponseReceivedListener(route);
    // Foreground receipt: banners are suppressed, so refresh the store —
    // the feed and badges update in place of the banner.
    const receiveSub = Notifications.addNotificationReceivedListener(() => {
      refreshRef.current().catch(() => {});
    });
    return () => {
      responseSub.remove();
      receiveSub.remove();
    };
  }, []);

  return null;
}
