import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthProvider } from "@/components/auth-context";
import { ThemeSync } from "@/components/theme-sync";
import { UpgradeCelebration } from "@/components/upgrade-celebration";
import { MyTeamProvider } from "@/lib/my-team";
import { TeamStep } from "@/components/team-step";
import { AppProviders } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import type { UserProfile } from "@scoutable/shared/types/org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // This server-side row feeds ONLY the shell. Do NOT seed AuthProvider with
  // it: ThemeSync's protocol requires profile to arrive asynchronously after
  // user (see theme-sync.ts header), and this select omits the theme_* columns
  // — a synchronous seed would adopt an all-null theme snapshot and push this
  // device's defaults over every other device's picks.
  let profile: UserProfile | null = null;
  try {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin")
      .eq("id", user.id)
      .single();
    if (data) {
      profile = {
        id: data.id,
        fullName: data.full_name,
        email: user.email ?? null,
        avatarUrl: data.avatar_url,
        role: data.role as UserProfile["role"],
        orgId: data.org_id,
        createdAt: data.created_at,
        isPlatformAdmin: data.is_platform_admin ?? false,
      };
    }
  } catch {
    // Profile may not exist yet
  }

  return (
    <AppProviders>
      <AuthProvider>
        <MyTeamProvider>
          <ThemeSync />
          <UpgradeCelebration />
          <TeamStep />
          <AppShell profile={profile}>{children}</AppShell>
        </MyTeamProvider>
      </AuthProvider>
    </AppProviders>
  );
}
