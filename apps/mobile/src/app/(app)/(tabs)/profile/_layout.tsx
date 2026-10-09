import { Stack } from "expo-router";
import { useTabStackOptions } from "@/components/shell/stack-options";

export default function ProfileStack() {
  return (
    <Stack screenOptions={useTabStackOptions()}>
      <Stack.Screen name="index" options={{ title: "Profile" }} />
    </Stack>
  );
}
