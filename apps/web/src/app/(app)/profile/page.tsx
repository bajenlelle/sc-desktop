"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import posthog from "posthog-js";
import { toast } from "sonner";
import { ArrowUpRight, Building2, Laptop, Loader2, LogOut, MessageSquarePlus } from "lucide-react";
import type { OrgContext } from "@scoutable/shared/types/org";
import { orgPlanColors, orgPlanLabel, type ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { useAuth } from "@/components/auth-context";
import { DeleteAccountDialog } from "@/components/delete-account-dialog";
import { DevicesCard } from "@/components/devices-card";
import { MarketingEmailToggle } from "@/components/marketing-email-toggle";
import { MyTeamCard } from "@/components/my-team-card";
import { ReportProblemDialog } from "@/components/report-problem-dialog";
import { ThemePicker } from "@/components/theme-picker";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { DESKTOP_APP_URL } from "@/components/shell/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupHeader, GroupedList, GroupRow } from "@/components/ui/group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { createClient } from "@/lib/supabase/client";
import { signOutAndLeave } from "@/lib/sign-out";
import { getOrgContext, updateMyProfile, uploadAvatar, getSubscriptionStatus } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { formatDate as formatLongDate } from "@/lib/format-date";

// Query params must precede the fragment or the browser drops them.
const PRICING_URL_BASE = "https://scoutable.se/pricing";

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

function roleBadgeVariant(role: string, isPlatformAdmin: boolean): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

export default function ProfilePage() {
  const { user, activeOrgId, activeOrgRole, activeOrgPlan, activeOrgIsPersonal, expectPlanChange } = useAuth();
  const { theme, setTheme } = useTheme();

  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [importQuota, setImportQuota] = useState<ImportQuota | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const [fullName, setFullName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setSub(null);
    setImportQuota(null);
    try {
      const [context, subStatus] = await Promise.all([
        getOrgContext(),
        activeOrgIsPersonal ? getSubscriptionStatus() : Promise.resolve(null),
      ]);
      setCtx(context);
      setSub(subStatus);
      setFullName(context.profile.fullName ?? "");
      setAvatarPreview(context.profile.avatarUrl ?? null);

      if (activeOrgIsPersonal && activeOrgId) {
        // Server owns the numbers (tier base + campaign grants).
        const supabase = createClient();
        const { data } = await supabase.rpc("get_import_quota", { p_org_id: activeOrgId });
        const q = data as Record<string, unknown> | null;
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
      }
    } catch {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  // Depend on activeOrgIsPersonal too: useAuth() populates activeOrgId first
  // and the isPersonal flag a tick later, and the load() ternary needs the
  // flag to decide whether to fetch the Stripe sub. Without this dep the
  // Manage-subscription button stays hidden for Rookie/Pro users.
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


  async function handleManageSubscription() {
    setLoadingPortal(true);
    try {
      const res = await fetch("/api/billing-portal", { method: "POST" });
      const { url, error } = await res.json();
      if (error) { toast.error(error); return; }
      if (url) window.location.href = url;
    } catch {
      toast.error("Failed to open billing portal");
    } finally {
      setLoadingPortal(false);
    }
  }

  /**
   * Anyone with a live subscription changes plans in the Stripe portal —
   * Checkout would open a second subscription alongside the first and bill
   * them twice. Only users without one go to the pricing page.
   *
   * The email rides along so Checkout can lock the address field to the
   * account's own, which is what the webhook matches on.
   */
  function handleUpgrade() {
    if (sub?.isActive) {
      trackEvent("upgrade_clicked", { source: "profile", has_subscription: true });
      void handleManageSubscription();
      return;
    }
    trackEvent("upgrade_clicked", { source: "profile", has_subscription: false });
    const email = user?.email;
    // ph_did links the pricing page's anonymous PostHog person back to this
    // account.
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (posthog.__loaded) params.set("ph_did", posthog.get_distinct_id());
    const qs = params.toString();
    const url = qs ? `${PRICING_URL_BASE}?${qs}` : PRICING_URL_BASE;
    window.open(url, "_blank");
    // Checkout runs in the new tab while this one stays mounted (unlike the
    // portal path, which navigates away and remounts fresh on return) — so
    // poll for the webhook's tier write.
    expectPlanChange();
  }

  if (loading) {
    return (
      <Page width="narrow">
        <Toolbar title="Profile" />
        <PageContent>
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        </PageContent>
      </Page>
    );
  }

  if (!ctx) {
    return (
      <Page width="narrow">
        <Toolbar title="Profile" />
        <PageContent>
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-title-3">Couldn&apos;t load your profile</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Try again
            </Button>
          </div>
        </PageContent>
      </Page>
    );
  }

  const profile = ctx.profile;
  const displayRole = activeOrgRole ?? profile.role;
  const initials = (fullName || user?.email || "?").slice(0, 2).toUpperCase();
  const activeOrg = ctx.myOrgs.find((o) => o.orgId === activeOrgId) ?? null;
  const activeOrgTeams = activeOrgId ? ctx.myTeams.filter((t) => t.orgId === activeOrgId) : [];
  // Managing a club is staff-only; players get the same row read-only.
  const canManageActiveOrg =
    !!activeOrg && !activeOrg.isPersonal && (activeOrg.role === "coach" || activeOrg.role === "admin");

  const planColors = orgPlanColors(activeOrgPlan);
  const planLabel = orgPlanLabel(activeOrgPlan);
  const isTrialing = sub?.status === "trialing";
  const isFreeOrRookie = activeOrgPlan === "free" || activeOrgPlan === "rookie";
  const periodDate = formatDate(sub?.currentPeriodEnd ?? null);
  const planStatus = activeOrgIsPersonal ? (sub?.isActive ? (isTrialing ? "Trial" : "Active") : "Free") : "Active";
  // Usage only for personal spaces on limited plans (free / rookie); club
  // spaces have no limit and don't show the count.
  const showUsage = activeOrgIsPersonal && importQuota !== null;
  const usageRatio = importQuota?.limit ? importQuota.used / importQuota.limit : 0;
  const usageAtCap = showUsage && (importQuota!.remaining ?? 0) <= 0;
  // Lifetime pools are small (Free = 3): warn from 65% so 2-of-3 shows amber.
  const usageWarn =
    showUsage && !usageAtCap && usageRatio >= (importQuota!.window === "lifetime" ? 0.65 : 0.8);

  return (
    <Page width="narrow">
      <Toolbar title="Profile" />
      <PageContent className="space-y-7">
        {/* ── Identity ── */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="group relative size-16 shrink-0 rounded-full outline-none transition-transform duration-150 active:scale-95 focus-visible:ring-2 focus-visible:ring-selection focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change photo"
          >
            <Avatar className="size-16">
              {avatarPreview && <AvatarImage src={avatarPreview} alt="" className="object-cover" />}
              <AvatarFallback className="bg-primary/15 text-lg font-semibold text-primary">{initials}</AvatarFallback>
            </Avatar>
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-callout font-medium text-white opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/30 group-hover:opacity-100">
              Edit
            </span>
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
          <div className="min-w-0">
            <p className="truncate text-title-1 text-foreground">{fullName || user?.email?.split("@")[0] || "—"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-callout text-muted-foreground">
              {(!activeOrgIsPersonal || profile.isPlatformAdmin) && (
                <Badge variant={roleBadgeVariant(displayRole, profile.isPlatformAdmin)}>
                  {roleLabel(displayRole, profile.isPlatformAdmin)}
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
                  <span className="font-medium">{planLabel}</span>
                  <span className={cn("rounded-full px-2 py-px text-caption", planColors.badge)}>{planStatus}</span>
                </span>
              }
              description={
                activeOrgIsPersonal
                  ? periodDate
                    ? `${isTrialing ? "Trial ends" : "Renews"} ${periodDate}`
                    : undefined
                  : "Managed by your club's admin"
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
                      <button type="button" onClick={handleUpgrade} className="font-medium text-primary hover:underline">
                        Upgrade for unlimited
                      </button>
                    )}
                    <span
                      className={cn(
                        "nums",
                        usageAtCap ? "font-medium text-destructive" : usageWarn ? "font-medium text-warning" : "text-foreground",
                      )}
                    >
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
                label={activeOrgPlan === "free" ? "Upgrade to Rookie or Pro" : "Upgrade to Pro"}
                description="More imports and clean exports"
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

        <MyTeamCard />

        {/* ── The active club, read-only for players ── */}
        {activeOrg && !activeOrg.isPersonal && (
          <section>
            <GroupHeader title="Club" />
            <GroupedList>
              <GroupRow
                label={activeOrg.orgName}
                description={activeOrgTeams.length > 0 ? activeOrgTeams.map((t) => t.name).join(" · ") : undefined}
                trailing={
                  <>
                    <span>{roleLabel(activeOrg.role)}</span>
                    {activeOrg.isNtOrg && <span>NT</span>}
                    {canManageActiveOrg && (
                      <Button variant="outline" size="xs" asChild>
                        <Link href="/organization">Manage…</Link>
                      </Button>
                    )}
                  </>
                }
              />
            </GroupedList>
          </section>
        )}

        {/* ── Personal info ── */}
        <section>
          <GroupHeader title="Personal info" />
          <GroupedList>
            <div className="flex min-h-11 items-center gap-4 px-4 py-2">
              <Label htmlFor="full-name" className="w-24 shrink-0 text-sm text-muted-foreground">
                Full name
              </Label>
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
              description="Tap your picture above to change it. Max 5 MB."
              trailing={
                <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                  {saving && <Loader2 className="animate-spin" />}
                  Save changes
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

        {/* ── Appearance: follows the system unless Light or Dark is picked;
               the choice (and the themes) follow the account to every app. ── */}
        <section>
          <GroupHeader title="Appearance" />
          <GroupedList>
            {/* Beside its label from sm; under it, full width, on a phone. */}
            <div className="flex min-h-11 flex-col gap-3 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-foreground">Appearance</span>
                <span className="text-callout text-muted-foreground">Light, dark, or follow the system</span>
              </div>
              <SegmentedControl
                aria-label="Appearance"
                className="max-sm:w-full max-sm:[&>button]:flex-1"
                value={(theme as "system" | "light" | "dark" | undefined) ?? "system"}
                onValueChange={(v) => setTheme(v)}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </div>
            <div className="px-4 py-3">
              <p className="mb-3 text-sm text-foreground">Theme</p>
              <ThemePicker />
            </div>
          </GroupedList>
          <GroupFooter>Picking a theme applies it right away. Your choice follows you to the desktop and mobile apps.</GroupFooter>
        </section>

        <DevicesCard />

        {/* ── Help: beside the sidebar these live in its account menu ── */}
        <section className="lg:hidden">
          <GroupHeader title="Help" />
          <GroupedList>
            <GroupRow leading={<MessageSquarePlus />} label="Send feedback…" onClick={() => setFeedbackOpen(true)} chevron />
            <a
              href={DESKTOP_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
            >
              <Laptop className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">Get the desktop app</span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/60" />
            </a>
          </GroupedList>
        </section>
        <ReportProblemDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />

        <GroupedList>
          <GroupRow onClick={() => void signOutAndLeave()}>
            <LogOut className="size-4 shrink-0 text-muted-foreground" />
            {/* One string, not text plus an email node: see lib/sign-out.ts. */}
            <span className="flex-1 text-sm text-foreground">
              {user?.email ? `Sign out of ${user.email}` : "Sign out"}
            </span>
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
      </PageContent>
    </Page>
  );
}
