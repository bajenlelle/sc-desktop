'use client'
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { GroupedList, GroupHeader, GroupRow } from "@/components/ui/group";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  getOrgContext,
  updateMyProfile,
  uploadAvatar,
  getSubscriptionStatus,
} from "@/lib/profile-db";
import { openBillingPortal, openUpgradeFlow } from "@/lib/billing";
import { DeleteAccountDialog } from "@/components/delete-account-dialog";
import type { OrgContext } from "@/types/org";
import { toast } from "sonner";
import { LogOut, Building2, ArrowUpRight, Loader2 } from "lucide-react";
import { orgPlanColors, orgPlanLabel, type ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { DevicesCard } from "@/components/devices-card";
import { MarketingEmailToggle } from "@/components/marketing-email-toggle";
import { MyTeamCard } from "@/components/my-team-card";
import { PlayerGamesCard } from "@/components/player-games-card";
import { usePlayerAccess } from "@/lib/player-access";
import { cn } from "@/lib/utils";
import { formatDate as formatLongDate } from "@/lib/format-date";

type SubStatus = {
  isActive: boolean;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return formatLongDate(iso, "long");
}

function roleBadgeVariant(role: string | null, isPlatformAdmin: boolean): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

export function ProfilePage() {
  const { user, activeOrgId, activeOrgPlan, activeOrgRole, activeOrgIsPersonal, expectPlanChange, setActiveOrg, reloadProfile } = useAuth();
  const { playerMode } = usePlayerAccess();
  const navigate = useNavigate();

  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [importQuota, setImportQuota] = useState<ImportQuota | null>(null);

  const [fullName, setFullName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [context, quotaRes, subStatus] = await Promise.all([
        getOrgContext(),
        createClient().rpc("get_import_quota", { p_org_id: activeOrgId ?? null }),
        activeOrgIsPersonal ? getSubscriptionStatus() : Promise.resolve(null as SubStatus | null),
      ]);
      setCtx(context);
      const q = quotaRes.data as Record<string, unknown> | null;
      setImportQuota(
        q && q.limit != null
          ? {
              tier: q.tier as ImportQuota["tier"],
              window: q.window as ImportQuota["window"],
              baseLimit: q.base_limit as number,
              bonus: (q.bonus as number) ?? 0,
              limit: q.limit as number,
              used: q.used as number,
              remaining: q.remaining as number,
            }
          : null,
      );
      setSub(subStatus);
      setFullName(context.profile.fullName ?? "");
      setAvatarPreview(context.profile.avatarUrl ?? null);
    } catch {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  // Skip when signed out: sign-out (local or from another device) collapses
  // auth state while this page is still mounted, and reloading with a dead
  // session would toast "Failed to load profile" mid-redirect.
  useEffect(() => {
    if (!user) return;
    load();
  }, [user?.id, activeOrgId, activeOrgIsPersonal]);

  function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Avatar must be under 5 MB"); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSaveProfile() {
    setSaving(true);
    try {
      let avatarUrl: string | undefined;
      if (avatarFile) avatarUrl = await uploadAvatar(avatarFile);
      await updateMyProfile({ fullName, ...(avatarUrl ? { avatarUrl } : {}) });
      toast.success("Profile saved");
      setAvatarFile(null);
      await load();
      // The sidebar's name and picture come from the shared profile.
      void reloadProfile();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!user?.email) return;
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(user.email);
    toast.success("Password reset email sent");
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    navigate("/auth/login");
  }

  async function handleManageSubscription() {
    setLoadingPortal(true);
    try {
      const error = await openBillingPortal();
      if (error) toast.error(error);
      else expectPlanChange();
    } finally {
      setLoadingPortal(false);
    }
  }

  /**
   * Upgrade routes through the portal for anyone with a live subscription —
   * Checkout would open a *second* one alongside it and bill them twice.
   */
  async function handleUpgrade() {
    setLoadingPortal(true);
    try {
      const error = await openUpgradeFlow(user?.email);
      if (error) toast.error(error);
      else expectPlanChange();
    } finally {
      setLoadingPortal(false);
    }
  }

  if (loading) {
    return (
      <Page>
        <Toolbar title="Profile" />
        <PageContent width="narrow">
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <div className="size-16 animate-pulse rounded-full bg-fill-3" />
              <div className="space-y-2">
                <div className="h-5 w-40 animate-pulse rounded bg-fill-3" />
                <div className="h-3 w-24 animate-pulse rounded bg-fill-2" />
              </div>
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-window bg-fill-2" />
            ))}
          </div>
        </PageContent>
      </Page>
    );
  }

  if (!ctx) {
    return (
      <Page>
        <Toolbar title="Profile" />
        <PageContent width="narrow">
          <p className="text-sm text-destructive">Failed to load profile.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLoading(true); load(); }}>
            Try again
          </Button>
        </PageContent>
      </Page>
    );
  }

  const profile = ctx.profile;
  const displayRole = activeOrgRole ?? profile.role;
  const initials = (fullName || user?.email || "?").slice(0, 2).toUpperCase();
  const activeOrg = ctx.myOrgs.find((o) => o.orgId === activeOrgId) ?? null;

  // Every club the user belongs to, with the teams they're on inside it.
  // ctx.myTeams already spans orgs, so this needs no extra queries — a
  // multi-club player previously saw only their active space here.
  const myClubs = ctx.myOrgs
    .filter((o) => !o.isPersonal)
    .map((o) => ({
      ...o,
      teamNames: ctx.myTeams.filter((t) => t.orgId === o.orgId).map((t) => t.name),
    }));

  // Plan & Usage — single source of truth: organizations.plan_tier (via activeOrgPlan).
  // Stripe sub state only drives ancillaries (period-end date, Manage button visibility).
  const planColors = orgPlanColors(activeOrgPlan);
  const planName = orgPlanLabel(activeOrgPlan);
  // Player passes (sales on, Free personal space): "Your games" below takes
  // over from the import meter, and only Pro is offered as an upgrade here.
  const showUsage = importQuota !== null && !playerMode;
  const usageRatio = importQuota?.limit ? importQuota.used / importQuota.limit : 0;
  const usageAtCap = showUsage && (importQuota!.remaining ?? 0) <= 0;
  // Lifetime pools are small (Free = 3): warn from 65% so 2 of 3 used already shows the warning.
  const usageWarn =
    showUsage && !usageAtCap && usageRatio >= (importQuota!.window === "lifetime" ? 0.65 : 0.8);
  const isTrialing = sub?.status === "trialing";
  const periodDate = formatDate(sub?.currentPeriodEnd ?? null);
  const isFreeOrRookie = activeOrgPlan === 'free' || activeOrgPlan === 'rookie';
  const planStatus = activeOrgIsPersonal
    ? (sub?.isActive ? (isTrialing ? "Trial" : "Active") : "Free")
    : "Org plan";

  return (
    <Page>
      <Toolbar title="Profile" />
      <PageContent width="narrow">
        <div className="space-y-7">
          {/* ── Identity ── */}
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-lg font-semibold text-primary outline-none transition-transform duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change photo"
            >
              {avatarPreview
                ? <img src={avatarPreview} alt="Avatar" className="size-full object-cover" />
                : <span>{initials}</span>}
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-callout font-medium text-white opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/30 group-hover:opacity-100">
                Edit
              </span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
            <div className="min-w-0">
              <p className="truncate text-title-1 text-foreground">
                {fullName || user?.email?.split("@")[0] || "—"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-callout text-muted-foreground">
                {(!activeOrgIsPersonal || profile.isPlatformAdmin) && (
                  <Badge variant={roleBadgeVariant(displayRole, profile.isPlatformAdmin)} className="text-caption">
                    {profile.isPlatformAdmin ? "Platform admin" : displayRole.charAt(0).toUpperCase() + displayRole.slice(1)}
                  </Badge>
                )}
                {activeOrg && !activeOrg.isPersonal && (
                  <span className="flex items-center gap-1">
                    <Building2 className="size-3" />
                    {activeOrg.orgName}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Plan and usage ── */}
          <section>
            <GroupHeader title="Plan and usage" />
            <GroupedList>
              <GroupRow
                label={
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", planColors.dot)} />
                    <span className="font-medium">{planName}</span>
                    <span className={cn("rounded-full px-2 py-px text-caption", planColors.badge)}>{planStatus}</span>
                  </span>
                }
                description={
                  activeOrgIsPersonal
                    ? periodDate ? `${isTrialing ? "Trial ends" : "Renews"} ${periodDate}` : undefined
                    : "Managed by your organization admin"
                }
              />
              {showUsage && (
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-callout">
                    <span className="text-muted-foreground">
                      {importQuota!.window === "lifetime" ? "Free game imports" : "Game imports this month"}
                    </span>
                    <span className="flex items-center gap-3">
                      {(usageWarn || usageAtCap) && (
                        <button
                          type="button"
                          onClick={handleUpgrade}
                          className="font-medium text-primary hover:underline"
                        >
                          {importQuota!.window === "lifetime" ? "Upgrade for more" : "Upgrade for unlimited"}
                        </button>
                      )}
                      <span className={cn("nums", usageAtCap ? "font-medium text-destructive" : usageWarn ? "font-medium text-warning" : "text-foreground")}>
                        {importQuota!.remaining} of {importQuota!.limit} left
                      </span>
                    </span>
                  </div>
                  <ProgressBar
                    percent={Math.min(100, usageRatio * 100)}
                    className="mt-2"
                    fillClassName={usageAtCap ? "bg-destructive" : usageWarn ? "bg-warning" : undefined}
                  />
                  <p className="mt-1.5 text-subheadline text-muted-foreground">
                    {importQuota!.window === "lifetime"
                      ? "Deleting games doesn't restore free imports. Re-importing the same game is always free."
                      : "Resets on the 1st of every month."}
                  </p>
                </div>
              )}
              {activeOrgIsPersonal && sub?.isActive && (
                <GroupRow
                  label="Subscription"
                  description="Billing, invoices and plan changes"
                  trailing={
                    <Button variant="outline" size="sm" onClick={handleManageSubscription} disabled={loadingPortal}>
                      {loadingPortal ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}
                      {loadingPortal ? "Opening…" : "Manage…"}
                    </Button>
                  }
                />
              )}
              {activeOrgIsPersonal && isFreeOrRookie && (
                <GroupRow
                  label="Upgrade to Pro"
                  description={playerMode ? "Unlimited games of any team" : "More imports and clean exports"}
                  trailing={
                    <Button size="sm" onClick={handleUpgrade} disabled={loadingPortal}>
                      <ArrowUpRight />
                      Upgrade…
                    </Button>
                  }
                />
              )}
            </GroupedList>
          </section>

          <PlayerGamesCard />

          <MyTeamCard />

          {/* ── My clubs ── membership across every club, mirroring the mobile
               profile. Staff additionally get a Manage shortcut per club — it
               switches the active space like the space menu's Manage action,
               since the org page manages the active org. Always rendered: this
               is the only entry point to joining a club on desktop. */}
          <section>
            <GroupHeader title={myClubs.length === 1 ? "My club" : "My clubs"} />
            <GroupedList>
              {myClubs.length === 0 && (
                <GroupRow label="No clubs yet" description="Your personal space works without one." />
              )}
              {myClubs.map((club) => (
                <GroupRow
                  key={club.orgId}
                  label={club.orgName}
                  description={club.teamNames.length > 0 ? club.teamNames.join(" · ") : undefined}
                  trailing={
                    <>
                      <span className="capitalize">{club.role}</span>
                      {club.isNtOrg && <span>NT</span>}
                      {(club.role === "coach" || club.role === "admin") && (
                        <Button
                          variant="outline"
                          size="xs"
                          aria-label={`Manage ${club.orgName}`}
                          onClick={() => {
                            // The org page manages the ACTIVE space — switch
                            // first, same as the space menu's Manage action.
                            setActiveOrg(club.orgId);
                            navigate("/organization");
                          }}
                        >
                          Manage
                        </Button>
                      )}
                    </>
                  }
                />
              ))}
              <GroupRow onClick={() => navigate("/onboarding")} chevron>
                <span className="flex-1 text-sm text-primary">Join a club…</span>
              </GroupRow>
            </GroupedList>
          </section>

          {/* ── Personal info ── */}
          <section>
            <GroupHeader title="Personal info" />
            <GroupedList>
              <div className="flex min-h-11 items-center gap-4 px-4 py-2">
                <Label htmlFor="full-name" className="w-24 shrink-0 text-sm text-muted-foreground">Full name</Label>
                <Input
                  id="full-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="h-8"
                />
              </div>
              <GroupRow
                label="Photo"
                description="Click your avatar above to change it. Max 5 MB."
                trailing={
                  <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                }
              />
            </GroupedList>
          </section>

          {/* ── Account ── */}
          <section>
            <GroupHeader title="Account" />
            <GroupedList>
              <GroupRow label="Email" trailing={<span className="truncate">{user?.email ?? ""}</span>} />
              <GroupRow
                label="Password"
                description="We'll email you a reset link"
                trailing={
                  <Button variant="outline" size="sm" onClick={handleChangePassword}>
                    Change password…
                  </Button>
                }
              />
              <MarketingEmailToggle />
            </GroupedList>
          </section>

          <DevicesCard />

          <GroupedList>
            <GroupRow onClick={handleSignOut}>
              <LogOut className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm text-foreground">Sign out of {user?.email}</span>
            </GroupRow>
          </GroupedList>

          <section>
            <GroupHeader title="Delete account" />
            <GroupedList>
              <GroupRow
                label="Delete account"
                description="Permanently erase your account and everything in it."
                trailing={
                  <DeleteAccountDialog
                    email={user?.email ?? ""}
                    trigger={
                      <Button variant="outline" size="sm" className="shrink-0 text-destructive hover:bg-destructive/10">
                        Delete…
                      </Button>
                    }
                  />
                }
              />
            </GroupedList>
          </section>
        </div>
      </PageContent>
    </Page>
  );
}
