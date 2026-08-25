import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function AuthLayout() {
  const { user, loading } = useAuth();
  // Already signed in → let the dispatcher pick the right destination.
  if (!loading && user) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
