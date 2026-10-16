import { AuthShell } from "@/components/auth/auth-frame";

/** Sign in and sign up share one frame: the app's mark over a narrow column. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
