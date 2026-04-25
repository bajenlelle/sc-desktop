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
import { countMatchesThisMonth } from "@/lib/matches-db";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { OrgContext } from "@/types/org";
import { toast } from "sonner";
import { LogOut, Zap, Users, Building2, ArrowUpRight, ChevronRight, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

const PRICING_URL = "https://scoutable.se/#pricing";
const BILLING_PORTAL_URL = "https://app.scoutable.se/api/billing-portal";

type SubStatus = {
  isActive: boolean;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
};

function getMonthlyImportLimit(sub: SubStatus | null): number | null {
  if (!sub || !sub.isActive) return 2;
  if (sub.plan === "rookie") return 10;
  return null;
}

function planLabel(sub: SubStatus | null): string {
  if (!sub || !sub.isActive) return "Free";
  const map: Record<string, string> = { rookie: "Rookie", pro: "Pro", franchise: "Franchise" };
  return map[sub.plan ?? ""] ?? "Free";
}

function planColors(sub: SubStatus | null): { dot: string; badge: string } {
  if (!sub || !sub.isActive) return { dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground" };
  if (sub.plan === "rookie") return { dot: "bg-blue-500", badge: "bg-blue-500/10 text-blue-500" };
  if (sub.plan === "pro") return { dot: "bg-violet-500", badge: "bg-violet-500/10 text-violet-500" };
  if (sub.plan === "franchise") return { dot: "bg-amber-500", badge: "bg-amber-500/10 text-amber-500" };
  return { dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground" };
}

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

export function ProfilePage() {
  const { user } = useAuth();
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
      const [context, subStatus, count] = await Promise.all([
        getOrgContext(),
        getSubscriptionStatus(),
        countMatchesThisMonth(),
      ]);
      setCtx(context);
      setSub(subStatus);
      setMonthCount(count);
      setFullName(context.profile.fullName ?? "");
      setAvatarPreview(context.profile.avatarUrl ?? null);
    } catch {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Not signed in"); return; }
      const res = await tauriFetch(BILLING_PORTAL_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("Billing portal response:", res.status, text);
        toast.error("Failed to open subscription portal");
        return;
      }
      const { url, error } = await res.json();
      if (error) { toast.error(error); return; }
      if (url) await openUrl(url);
    } catch (e) {
      console.error("Manage subscription error:", e);
      toast.error("Failed to open subscription portal");
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
  const colors = planColors(sub);
  const monthlyLimit = getMonthlyImportLimit(sub);
  const showUsage = monthlyLimit !== null && monthCount !== null;
  const isTrialing = sub?.status === "trialing";
  const isFreeOrRookie = !sub?.isActive || sub.plan === "rookie";
  const dateLabel = isTrialing ? "Trial ends" : "Renews";
  const periodDate = formatDate(sub?.currentPeriodEnd ?? null);
  const initials = (fullName || user?.email || "?").slice(0, 2).toUpperCase();

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
                <Badge variant={roleBadgeVariant(profile.role, profile.isPlatformAdmin)} className="text-xs">
                  {profile.isPlatformAdmin ? "Platform admin" : profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                </Badge>
                {ctx.org && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    {ctx.org.name}
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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Plan & Usage
            </h2>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${colors.dot} flex-shrink-0`} />
              <span className="font-semibold text-foreground">{planLabel(sub)}</span>
              {sub?.isActive && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors.badge}`}>
                  {isTrialing ? "Trial" : "Active"}
                </span>
              )}
              {!sub?.isActive && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                  Free
                </span>
              )}
            </div>
            {periodDate && (
              <span className="text-xs text-muted-foreground">{dateLabel} {periodDate}</span>
            )}
          </div>

          {showUsage && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Games imported this month</span>
                <span className={monthCount >= monthlyLimit ? "text-destructive font-medium" : ""}>
                  {monthCount} / {monthlyLimit}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${monthCount >= monthlyLimit ? "bg-destructive" : "bg-primary"}`}
                  style={{ width: `${Math.min(100, (monthCount / monthlyLimit) * 100)}%` }}
                />
              </div>
            </div>
          )}

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
              onClick={() => openUrl(PRICING_URL)}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              {!sub?.isActive ? "Upgrade to Rookie or Pro" : "Upgrade to Pro"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Org & Teams ── */}
      {ctx.org && ctx.myTeams.length > 0 && (
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
              <span className="text-sm text-foreground">{ctx.org.name}</span>
            </div>
            {ctx.myTeams.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {ctx.myTeams.map((team) => (
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
