import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { trackEvent } from "@/lib/analytics";
import { getDeviceId } from "@/lib/device-registry";
import { getCachedPushToken } from "@/lib/notifications";
import { listMyDevices, pruneOtherPushTokens, removeDevice, type UserDevice } from "@scoutable/shared/lib/devices-db";

/**
 * The account's registered devices (anti-account-sharing; the web's
 * DevicesCard), shared by the settings sheet's pages (the provider wraps its
 * stack), so the count beside the Devices row and the Devices page are the
 * same list: the list (null while loading), this device's id, and the two
 * actions. Both ask first; "Sign out everywhere else" keeps this device's
 * push token and prunes the others (revoking refresh tokens alone doesn't
 * stop notifications).
 */
function useDevicesState() {
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

  function confirmSignOutOthers() {
    Alert.alert("Sign out everywhere else?", "Your other devices will need to sign in again. This one stays signed in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOutOthers() },
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

  return { devices, ownDeviceId, removingId, signingOut, confirmRemove, confirmSignOutOthers };
}

type MyDevices = ReturnType<typeof useDevicesState>;

const MyDevicesContext = createContext<MyDevices | null>(null);

export function MyDevicesProvider({ children }: { children: ReactNode }) {
  return <MyDevicesContext.Provider value={useDevicesState()}>{children}</MyDevicesContext.Provider>;
}

export function useMyDevices(): MyDevices {
  const value = useContext(MyDevicesContext);
  if (!value) throw new Error("useMyDevices outside MyDevicesProvider (the settings sheet's layout)");
  return value;
}
