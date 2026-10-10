import { Redirect, useLocalSearchParams } from "expo-router";
import { DeviceGateScreen } from "@/components/DeviceGateScreen";
import SignIn from "../(auth)/sign-in";
import SignUp from "../(auth)/sign-up";
import ForgotPassword from "../(auth)/forgot-password";

/**
 * Dev-only previews of screens that can't be reached safely in the
 * read-only test session (or while signed in):
 * /dev-preview?screen=device-gate | crash | sign-in | sign-up | forgot.
 * Removed with dev-gallery before merge.
 */
function Crash(): never {
  throw new Error("Preview of the error screen");
}

export default function DevPreview() {
  const { screen } = useLocalSearchParams<{ screen?: string }>();
  if (!__DEV__) return <Redirect href="/" />;
  if (screen === "crash") return <Crash />;
  if (screen === "sign-in") return <SignIn />;
  if (screen === "sign-up") return <SignUp />;
  if (screen === "forgot") return <ForgotPassword />;
  return <DeviceGateScreen />;
}
