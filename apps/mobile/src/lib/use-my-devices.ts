import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { getDeviceId } from "@/lib/device-registry";
import { getCachedPushToken } from "@/lib/notifications";
import { listMyDevices, pruneOtherPushTokens, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";

/**
 * The account's registered devices (anti-account-sharing; the web's
 * DevicesCard), for the Devices page and the count beside its row in
 * Settings: the list (null while loading), this device's id, and the two
 * actions. Removing asks first; "Sign out everywhere else" keeps this
 * device's push token and prunes the others (revoking refresh tokens alone
 * doesn't stop notifications).
 */
export function useMyDevices() {
  const [devices, setDevices] = useState<UserDevice[] | null>(null);
  const [ownDeviceId, setOwnDeviceId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await listMyDevices(supabase));
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void load();
    getDeviceId().then(setOwnDeviceId);
  }, [load]);

  async function remove(d: UserDevice) {
    setRemovingId(d.deviceId);
    try {
      await removeDevice(supabase, d.deviceId);
      trackEvent("device_removed", { source: "profile", target_app: d.app });
      await load();
    } catch {
      Alert.alert("Couldn't remove the device", "Try again.");
    } finally {
      setRemovingId(null);
    }
  }

  function confirmRemove(d: UserDevice) {
    const name = d.deviceName ?? d.platform ?? "Unknown device";
    Alert.alert("Remove this device?", `${name} will lose access the next time it opens Scoutable.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void remove(d) },
    ]);
  }

  async function signOutOthers() {
    setSigningOut(true);
    try {
      await pruneOtherPushTokens(supabase, getCachedPushToken());
      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      Alert.alert("Signed out everywhere else", "Other devices will be logged out the next time they're used.");
    } catch {
      Alert.alert("Something went wrong", "Couldn't sign out other devices. Try again.");
    } finally {
      setSigningOut(false);
    }
  }

  return { devices, ownDeviceId, removingId, signingOut, confirmRemove, signOutOthers };
}
