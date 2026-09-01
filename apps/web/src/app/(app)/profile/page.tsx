"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-context";
import { getOrgContext, updateMyProfile, uploadAvatar, getSubscriptionStatus } from "@/lib/profile-db";
import { trackEvent } from "@/lib/analytics";
import posthog from "posthog-js";
import type { OrgContext } from "@scoutable/shared/types/org";
import { orgPlanColors, orgPlanLabel, type ImportQuota } from "@scoutable/shared/lib/plan-tier";
import { toast } from "sonner";
import { DeleteAccountDialog } from "@/components/delete-account-dialog";
import { DevicesCard } from "@/components/devices-card";
import { LogOut, Zap, Users, Building2, ArrowUpRight, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";

// Query params must precede the fragment or the browser drops them.
const PRICING_URL_BASE = "https://scoutable.se/";

type SubStatus = {
  isActive: boolean;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-SE", { day: "numeric", month: "long", year: "numeric" });
}

function roleBadgeVariant(role: string, isPlatformAdmin: boolean): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

export default function ProfilePage() {
  const { user, activeOrgId, activeOrgRole, activeOrgPlan, activeOrgIsPersonal, expectPlanChange } = useAuth();
  const router = useRouter();

  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [importQuota, setImportQuota] = useState<ImportQuota | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);

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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut({ scope: "local" });
    router.push("/login");
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
    // account; params must precede the #pricing fragment.
    const params = new URLSearchParams();
    if (email) params.set("email", email);
    if (posthog.__loaded) params.set("ph_did", posthog.get_distinct_id());
    const qs = params.toString();
    const url = qs ? `${PRICING_URL_BASE}?${qs}#pricing` : `${PRICING_URL_BASE}#pricing`;
    window.open(url, "_blank");
    // Checkout runs in the new tab while this one stays mounted (unlike the
    // portal path, which navigates away and remounts fresh on return) — so
    // poll for the webhook's tier write.
    expectPlanChange();
  }

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-destructive">Failed to load profile.</p>
        <button className="mt-2 text-sm text-primary underline" onClick={() => { setLoading(true); load(); }}>
          Retry
        </button>
      </div>
    );
  }

  const profile = ctx.profile;
  const displayRole = activeOrgRole ?? profile.role;
  const initials = (fullName || user?.email || "?").slice(0, 2).toUpperCase();
  const activeOrg = ctx.myOrgs.find((o) => o.orgId === activeOrgId) ?? null;
  const activeOrgTeams = activeOrgId ? ctx.myTeams.filter((t) => t.orgId === activeOrgId) : [];
  // Managing a club is staff-only; players get the same card read-only.
  const canManageActiveOrg =
    !!activeOrg && !activeOrg.isPersonal && (activeOrg.role === "coach" || activeOrg.role === "admin");

  const planColors = orgPlanColors(activeOrgPlan);
  const planLabel = orgPlanLabel(activeOrgPlan);
  const isTrialing = sub?.status === "trialing";
  const isFreeOrRookie = activeOrgPlan === "free" || activeOrgPlan === "rookie";
  const dateLabel = isTrialing ? "Trial ends" : "Renews";
  const periodDate = formatDate(sub?.currentPeriodEnd ?? null);
  // Progress bar only for personal spaces on limited plans (free / rookie).
  // Org spaces have no limit and don't display the count.
  const showUsage = activeOrgIsPersonal && importQuota !== null;
  const usageRatio = importQuota?.limit ? importQuota.used / importQuota.limit : 0;
  const usageAtCap = showUsage && (importQuota!.remaining ?? 0) <= 0;
  // Lifetime pools are small (Free = 3) — warn from 65% so 2-of-3 shows amber.
  const usageWarn =
    showUsage && !usageAtCap && usageRatio >= (importQuota!.window === "lifetime" ? 0.65 : 0.8);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-4">
      <div className="mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your account and subscription.</p>
      </div>

      {/* ── Identity header ── */}
      <Card className="overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
        <CardContent className="px-6 pb-6 pt-0">
          <div className="flex items-end gap-4 -mt-8">
            <button
              type="button"
              className="relative h-16 w-16 rounded-full overflow-hidden bg-primary/15 border-4 border-card flex items-center justify-center text-lg font-bold text-primary hover:opacity-80 transition-opacity flex-shrink-0"
              onClick={() => fileInputRef.current?.click()}
              title="Change avatar"
            >
              {avatarPreview
                ? <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
                : <span>{initials}</span>}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
            <div className="pb-1 min-w-0">
              <p className="text-base font-semibold text-foreground truncate">
                {fullName || user?.email?.split("@")[0] || "—"}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {(!activeOrgIsPersonal || profile.isPlatformAdmin) && (
                  <Badge variant={roleBadgeVariant(displayRole, profile.isPlatformAdmin)} className="text-xs">
                    {profile.isPlatformAdmin ? "Platform admin" : displayRole.charAt(0).toUpperCase() + displayRole.slice(1)}
                  </Badge>
                )}
                {activeOrg && !activeOrg.isPersonal && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    {activeOrg.orgName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Plan & Usage ── */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            Plan & Usage
          </h2>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${planColors.dot} flex-shrink-0`} />
              <span className="font-semibold text-foreground">{planLabel}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planColors.badge}`}>
                {activeOrgIsPersonal ? (sub?.isActive ? (isTrialing ? "Trial" : "Active") : "Free") : "Active"}
              </span>
            </div>
            {activeOrgIsPersonal && periodDate && (
              <span className="text-xs text-muted-foreground">{dateLabel} {periodDate}</span>
            )}
          </div>

          {activeOrgIsPersonal && sub?.isActive && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={handleManageSubscription}
              disabled={loadingPortal}
            >
              {loadingPortal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              {loadingPortal ? "Opening…" : "Manage subscription"}
            </Button>
          )}

          {activeOrgIsPersonal && isFreeOrRookie && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-1.5"
              onClick={handleUpgrade}
              disabled={loadingPortal}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {activeOrgPlan === "free" ? "Upgrade to Rookie or Pro" : "Upgrade to Pro"}
            </Button>
          )}

          {!activeOrgIsPersonal && (
            <p className="text-xs text-muted-foreground">
              Plan managed by your organization admin.
            </p>
          )}

          {showUsage && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {importQuota!.window === "lifetime"
                    ? "Free game imports"
                    : "Game imports this month"}
                </span>
                <span className="flex items-center gap-2">
                  {(usageWarn || usageAtCap) && (
                    <button
                      type="button"
                      onClick={handleUpgrade}
                      className="font-medium text-primary hover:underline"
                    >
                      Upgrade — unlimited imports
                    </button>
                  )}
                  <span className={usageAtCap ? "text-destructive font-medium" : usageWarn ? "text-amber-600 dark:text-amber-500 font-medium" : ""}>
                    {importQuota!.remaining} of {importQuota!.limit} left
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${usageAtCap ? "bg-destructive" : usageWarn ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, usageRatio * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {importQuota!.window === "lifetime"
                  ? "Deleting games doesn't restore free imports — re-importing the same game is always free."
                  : "Resets on the 1st of every month."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Org & Teams ── */}
      {activeOrg && !activeOrg.isPersonal && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                {canManageActiveOrg ? "Organization" : "My club"}
              </h2>
              {canManageActiveOrg && (
                <Link href="/organization" className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Manage <ChevronRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">{activeOrg.orgName}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground capitalize">{activeOrg.role}</span>
                {activeOrg.isNtOrg && <span className="text-xs text-muted-foreground">NT</span>}
              </div>
            </div>
            {activeOrgTeams.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeOrgTeams.map((team) => (
                  <span key={team.id} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {team.name}
                  </span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Personal Info ── */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Personal Info</h2>
          <div className="space-y-2">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <p className="text-xs text-muted-foreground">Click your avatar above to change photo. Max 5 MB.</p>
          <Button onClick={handleSaveProfile} disabled={saving} size="sm">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Account ── */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Account</h2>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} readOnly className="text-muted-foreground cursor-default" />
          </div>
          <Button variant="outline" size="sm" onClick={handleChangePassword}>
            Change password
          </Button>
        </CardContent>
      </Card>

      {/* ── Devices ── */}
      <DevicesCard />

      {/* ── Sign out ── */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            <span>Sign out of {user?.email}</span>
            <LogOut className="h-4 w-4 opacity-50 group-hover:opacity-100 transition-opacity" />
          </button>
        </CardContent>
      </Card>

      {/* ── Danger zone ── */}
      <Card className="border-destructive/40">
        <CardContent className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanently erase your account and everything in it.
            </p>
          </div>
          <DeleteAccountDialog
            email={user?.email ?? ""}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-red-600 border-red-600/40 hover:bg-red-600/10 hover:text-red-600"
              >
                Delete…
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
