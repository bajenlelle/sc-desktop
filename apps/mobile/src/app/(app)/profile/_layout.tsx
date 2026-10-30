import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useTabStackOptions } from "@/components/shell/stack-options";

/**
 * Settings, as a sheet over the app (the (app) stack presents this route
 * modally): its own stack, so its pages push inside the sheet and a swipe
 * down puts the whole sheet away. Its own safe-area provider measures the
 * sheet rather than the window: on iOS the page sheet starts below the
 * status bar, so the bar mustn't pad for it.
 */
export default function SettingsStack() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={useTabStackOptions()} />
    </SafeAreaProvider>
  );
}
