import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth-context";

export default function AuthLayout() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
