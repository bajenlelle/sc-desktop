import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Navbar } from "@/components/navbar";
import { FeedbackFab } from "@/components/feedback-fab";
import { AuthProvider } from "@/components/auth-context";
import { UpgradeCelebration } from "@/components/upgrade-celebration";
import type { UserProfile } from "@scoutable/shared/types/org";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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
    <AuthProvider>
      <UpgradeCelebration />
      <div className="min-h-screen flex flex-col">
        <Navbar profile={profile} />
        <main className="flex-1">{children}</main>
        <FeedbackFab />
      </div>
    </AuthProvider>
  );
}
