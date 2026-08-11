'use client'
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";
import {
  getOrgContext,
  updateMyProfile,
  uploadAvatar,
  getSubscriptionStatus,
} from "@/lib/profile-db";
import { countClubMatchesThisMonth } from "@/lib/matches-db";
import { NATIONAL_TEAM_LEAGUES } from "@/lib/basketball-api";
import { openBillingPortal, openUpgradeFlow } from "@/lib/billing";
import type { OrgContext } from "@/types/org";
import { toast } from "sonner";
import { LogOut, Zap, Users, Building2, ArrowUpRight, ChevronRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getOrgImportLimit, orgPlanColors, orgPlanLabel } from "@scoutable/shared/lib/plan-tier";


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

function roleBadgeVariant(role: string | null, isPlatformAdmin: boolean): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

export function ProfilePage() {
  const { user, activeOrgId, activeOrgPlan, activeOrgRole, activeOrgIsPersonal } = useAuth();
  const navigate = useNavigate();

  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sub, setSub] = useState<SubStatus | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [monthCount, setMonthCount] = useState<number | null>(null);

  const [fullName, setFullName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const ntLeagueIds = NATIONAL_TEAM_LEAGUES.map((l) => l.id);
      const promises: [Promise<OrgContext>, Promise<number>, Promise<SubStatus | null>] = [
        getOrgContext(),
        countClubMatchesThisMonth(ntLeagueIds, activeOrgId ?? undefined),
        activeOrgIsPersonal ? getSubscriptionStatus() : Promise.resolve(null),
      ];
      const [context, count, subStatus] = await Promise.all(promises);
      setCtx(context);
      setMonthCount(count);
      setSub(subStatus);
      setFullName(context.profile.fullName ?? "");
      setAvatarPreview(context.profile.avatarUrl ?? null);
    } catch {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [activeOrgId, activeOrgIsPersonal]);

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
    await supabase.auth.signOut();
    navigate("/auth/login");
  }

  async function handleManageSubscription() {
    setLoadingPortal(true);
    try {
      const error = await openBillingPortal();
      if (error) toast.error(error);
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
    } finally {
      setLoadingPortal(false);
    }
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

  // Plan & Usage — single source of truth: organizations.plan_tier (via activeOrgPlan).
  // Stripe sub state only drives ancillaries (period-end date, Manage button visibility).
  const planColors = orgPlanColors(activeOrgPlan);
  const planName = orgPlanLabel(activeOrgPlan);
  const monthlyLimit = getOrgImportLimit(activeOrgPlan);
  const showUsage = monthlyLimit !== null && monthCount !== null;
  const isTrialing = sub?.status === "trialing";
  const periodDate = formatDate(sub?.currentPeriodEnd ?? null);
  const isFreeOrRookie = activeOrgPlan === 'free' || activeOrgPlan === 'rookie';

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
              <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center">
                <span className="text-white text-xs opacity-0 hover:opacity-100 font-medium">Edit</span>
              </div>
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
              <span className="font-semibold text-foreground">{planName}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planColors.badge}`}>
                {activeOrgIsPersonal
                  ? (sub?.isActive ? (isTrialing ? "Trial" : "Active") : "Free")
                  : "Org plan"}
              </span>
            </div>
            {activeOrgIsPersonal && periodDate && (
              <span className="text-xs text-muted-foreground">
                {isTrialing ? "Trial ends" : "Renews"} {periodDate}
              </span>
            )}
          </div>

          {showUsage && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Games imported this month</span>
                <span className={monthCount! >= monthlyLimit! ? "text-destructive font-medium" : ""}>
                  {monthCount} / {monthlyLimit}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${monthCount! >= monthlyLimit! ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (monthCount! / monthlyLimit!) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {activeOrgIsPersonal ? (
            <>
              {sub?.isActive && (
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
              {isFreeOrRookie && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={handleUpgrade}
                  disabled={loadingPortal}
                >
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  {activeOrgPlan === 'free' ? "Upgrade to Rookie or Pro" : "Upgrade to Pro"}
                </Button>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Plan managed by your organisation admin.
            </p>
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
                Organisation
              </h2>
              <Link to="/organization" className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                Manage <ChevronRight className="h-3 w-3" />
              </Link>
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
    </div>
  );
}
