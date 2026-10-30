import { Platform } from "react-native";
import { Stack, useNavigation } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useTabStackOptions } from "@/components/shell/stack-options";
import { MyDevicesProvider } from "@/lib/use-my-devices";

/**
 * Settings, as a sheet over the app (the (app) stack presents this route
 * modally): its own stack, so its pages push inside the sheet and a swipe
 * down puts the whole sheet away. Its own safe-area provider measures the
 * sheet rather than the window: on iOS the page sheet starts below the
 * status bar, so the bar mustn't pad for it, and the status bar sits over
 * the dark backdrop the sheet leaves at the top, so its text turns light
 * (not when a cold deep link opened Settings full screen, with nothing
 * under it). The devices list is shared by the pages.
 */
export default function SettingsStack() {
  const navigation = useNavigation();
  const asSheet = Platform.OS === "ios" && navigation.canGoBack();
  return (
    <SafeAreaProvider>
      {asSheet ? <StatusBar style="light" /> : null}
      <MyDevicesProvider>
        <Stack screenOptions={useTabStackOptions()} />
      </MyDevicesProvider>
    </SafeAreaProvider>
  );
}
