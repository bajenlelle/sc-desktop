"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getOrgContext,
  getOrgContextForOrg,
  generateInviteCode,
  listInvitesForTeam,
  deleteInvite,
  getTeamMemberCounts,
  generateOrgInviteCode,
  listOrgInvites,
  deleteOrgInvite,
  assignMemberToTeam,
  joinOrgTeam,
  promoteToAdmin,
  createTeam,
  removeOrgMember,
  removeTeamMember,
} from "@/lib/profile-db";
import type { OrgContext, OrgTeam, TeamInvite, OrgInvite, UserProfile } from "@scoutable/shared/types/org";
import { toast } from "sonner";
import { Clipboard, Check, RefreshCw, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-context";
import Link from "next/link";
import { cn } from "@/lib/utils";

function roleBadgeVariant(
  role: string,
  isPlatformAdmin = false
): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

// ---------------------------------------------------------------------------
// InviteCard
// ---------------------------------------------------------------------------

function InviteCard({
  label,
  description,
  code,
  entityName,
  onRegenerate,
  regenerating,
}: {
  label: string;
  description: string;
  code: string | null;
  entityName: string;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  function handleCopy() {
    if (!code) return;
    navigator.clipboard.writeText(`Join ${entityName} on Scoutable — Code: ${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCopyLink() {
    if (!code) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${code}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {code ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-md border border-border bg-muted/50 px-3 py-1.5 font-mono text-sm font-medium shrink-0">
              {code}
            </div>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy Code"}
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleCopyLink}>
              {copiedLink ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Link2 className="h-3.5 w-3.5" />}
              {copiedLink ? "Copied!" : "Copy Link"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1.5 text-muted-foreground"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${regenerating ? "animate-spin" : ""}`} />
              {regenerating ? "Regenerating…" : "Regenerate"}
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={onRegenerate}
            disabled={regenerating}
          >
            {regenerating ? "Generating…" : "Generate Code"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// OrgInviteSection
// ---------------------------------------------------------------------------

function OrgInviteSection({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [regeneratingRole, setRegeneratingRole] = useState<string | null>(null);

  async function load() {
    setLoadingInvites(true);
    try {
      setInvites(await listOrgInvites(orgId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingInvites(false);
    }
  }

  useEffect(() => { load(); }, [orgId]);

  async function handleRegenerate(role: "coach" | "player") {
    setRegeneratingRole(role);
    try {
      const toDelete = invites.filter((i) => i.role === role);
      await Promise.all(toDelete.map((i) => deleteOrgInvite(i.id)));
      await generateOrgInviteCode(orgId, role);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegeneratingRole(null);
    }
  }

  if (loadingInvites) {
    return <p className="text-sm text-muted-foreground">Loading invite codes…</p>;
  }

  const coachInvite = invites.find((i) => i.role === "coach");
  const playerInvite = invites.find((i) => i.role === "player");

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Invite Codes</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <InviteCard
          label="Coach Invite"
          description="Share this code with coaches to join your organization"
          code={coachInvite?.code ?? null}
          entityName={orgName}
          onRegenerate={() => handleRegenerate("coach")}
          regenerating={regeneratingRole === "coach"}
        />
        <InviteCard
          label="Player Invite"
          description="Share this code with players to join your organization"
          code={playerInvite?.code ?? null}
          entityName={orgName}
          onRegenerate={() => handleRegenerate("player")}
          regenerating={regeneratingRole === "player"}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamInviteSection
// ---------------------------------------------------------------------------

function TeamInviteSection({
  team,
  orgMembers,
  isAdmin,
  onContextReload,
}: {
  team: OrgTeam;
  orgMembers: UserProfile[];
  isAdmin: boolean;
  onContextReload: () => void;
}) {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [regeneratingRole, setRegeneratingRole] = useState<string | null>(null);
  const [teamMemberDetails, setTeamMemberDetails] = useState<{ userId: string; role: string }[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [removingTeamMemberId, setRemovingTeamMemberId] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  const supabase = createClient();

  async function load() {
    setLoadingInvites(true);
    try {
      setInvites(await listInvitesForTeam(team.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingInvites(false);
    }
  }

  async function loadCurrentMembers() {
    setLoadingMembers(true);
    try {
      const { data } = await supabase
        .from("team_members")
        .select("user_id, role")
        .eq("team_id", team.id);
      setTeamMemberDetails((data ?? []).map((r: { user_id: string; role: string }) => ({ userId: r.user_id, role: r.role })));
    } finally {
      setLoadingMembers(false);
    }
  }

  useEffect(() => { load(); loadCurrentMembers(); }, [team.id]);

  async function handleRegenerate(role: "coach" | "player") {
    setRegeneratingRole(role);
    try {
      const toDelete = invites.filter((i) => i.role === role);
      await Promise.all(toDelete.map((i) => deleteInvite(i.id)));
      await generateInviteCode(team.id, role);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegeneratingRole(null);
    }
  }

  async function handleRemoveTeamMember(userId: string) {
    setRemovingTeamMemberId(userId);
    try {
      await removeTeamMember(userId, team.id);
      toast.success("Member removed from team");
      onContextReload();
      loadCurrentMembers();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingTeamMemberId(null);
    }
  }

  async function handleAddMember() {
    if (!selectedUserId) return;
    const member = availableToAdd.find((m) => m.id === selectedUserId);
    if (!member) return;
    setAddingMember(true);
    try {
      await assignMemberToTeam(selectedUserId, team.id, member.role as "coach" | "player");
      toast.success("Member added to team");
      setShowAddMember(false);
      setSelectedUserId("");
      onContextReload();
      loadCurrentMembers();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAddingMember(false);
    }
  }

  const currentMemberIdSet = new Set(teamMemberDetails.map((m) => m.userId));
  const availableToAdd = orgMembers.filter((m) => !currentMemberIdSet.has(m.id));
  const coachInvite = invites.find((i) => i.role === "coach");
  const playerInvite = invites.find((i) => i.role === "player");

  if (loadingInvites) {
    return <p className="text-xs text-muted-foreground px-4 pb-3">Loading…</p>;
  }

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
      {/* Member list */}
      {!loadingMembers && teamMemberDetails.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Members ({teamMemberDetails.length})</p>
          {teamMemberDetails.map((tm) => {
            const profile = orgMembers.find((m) => m.id === tm.userId);
            const displayName = profile?.fullName ?? profile?.email ?? tm.userId.slice(0, 8);
            const secondaryText = profile?.fullName && profile?.email ? profile.email : null;
            return (
              <div key={tm.userId} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <span className="text-sm">{displayName}</span>
                  {secondaryText && (
                    <p className="text-xs text-muted-foreground">{secondaryText}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={roleBadgeVariant(tm.role)} className="text-xs">{tm.role}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    disabled={removingTeamMemberId === tm.userId}
                    onClick={() => handleRemoveTeamMember(tm.userId)}
                  >
                    {removingTeamMemberId === tm.userId ? "Removing…" : "Remove"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Invite cards */}
      <div className="grid gap-3 sm:grid-cols-2">
        <InviteCard
          label="Player Invite"
          description="Share with players to join this team"
          code={playerInvite?.code ?? null}
          entityName={team.name}
          onRegenerate={() => handleRegenerate("player")}
          regenerating={regeneratingRole === "player"}
        />
        <InviteCard
          label="Coach Invite"
          description="Share with coaches to join this team"
          code={coachInvite?.code ?? null}
          entityName={team.name}
          onRegenerate={() => handleRegenerate("coach")}
          regenerating={regeneratingRole === "coach"}
        />
      </div>

      {/* Add Member (admin only) */}
      {isAdmin && orgMembers.length > 0 && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAddMember((v) => !v); setSelectedUserId(""); }}>
            {showAddMember ? "Cancel" : "Add Member"}
          </Button>
          {showAddMember && (
            <div className="flex items-center gap-2">
              {availableToAdd.length === 0 ? (
                <p className="text-xs text-muted-foreground">All org members are already in this team.</p>
              ) : (
                <>
                  <select
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                  >
                    <option value="">Select member…</option>
                    {availableToAdd.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName ?? m.email ?? m.id.slice(0, 8)} ({m.role})
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    disabled={!selectedUserId || addingMember}
                    onClick={handleAddMember}
                  >
                    {addingMember ? "Adding…" : "Add"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamCard
// ---------------------------------------------------------------------------

function TeamCard({
  team,
  memberCount,
  userTeamRole,
  canManage,
  isAdmin,
  orgMembers,
  onContextReload,
}: {
  team: OrgTeam;
  memberCount: number;
  userTeamRole: string;
  canManage: boolean;
  isAdmin: boolean;
  orgMembers: UserProfile[];
  onContextReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors rounded-lg"
        onClick={() => { if (canManage) setExpanded((v) => !v); }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{team.name}</span>
          {team.season && (
            <Badge variant="outline" className="text-xs">{team.season}</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {memberCount} member{memberCount !== 1 ? "s" : ""}
          </span>
          <Badge variant={roleBadgeVariant(userTeamRole)} className="text-xs">
            {userTeamRole}
          </Badge>
        </div>
        {canManage && (
          expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && canManage && (
        <TeamInviteSection team={team} orgMembers={orgMembers} isAdmin={isAdmin} onContextReload={onContextReload} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OrganizationPage
// ---------------------------------------------------------------------------

export default function OrganizationPage() {
  const { user } = useAuth();
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [myTeamRoles, setMyTeamRoles] = useState<Record<string, string>>({});
  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSeason, setNewTeamSeason] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  async function load(orgId?: string) {
    try {
      const context = orgId ? await getOrgContextForOrg(orgId) : await getOrgContext();
      setCtx(context);

      if (context.org) {
        const counts = await getTeamMemberCounts(context.org.id);
        setMemberCounts(counts);
      }

      if (user && context.myTeams.length > 0) {
        const supabase = createClient();
        const { data } = await supabase
          .from("team_members")
          .select("team_id, role")
          .eq("user_id", user.id);
        const roles: Record<string, string> = {};
        for (const row of (data ?? []) as { team_id: string; role: string }[]) {
          roles[row.team_id] = row.role;
        }
        setMyTeamRoles(roles);
      }
    } catch {
      toast.error("Failed to load organization");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // If user has no primary org but has secondary orgs, auto-select the first one
  const ctxSecondaryOrgs = ctx?.secondaryOrgs ?? [];
  useEffect(() => {
    if (!loading && ctx?.org === null && ctxSecondaryOrgs.length > 0 && selectedOrgId === null) {
      handleSelectOrg(ctxSecondaryOrgs[0].orgId);
    }
  }, [loading, ctx?.org, ctxSecondaryOrgs.length]);

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      await createTeam(newTeamName.trim(), newTeamSeason.trim() || undefined, selectedOrgId ?? undefined);
      toast.success("Team created");
      setNewTeamName("");
      setNewTeamSeason("");
      setShowNewTeam(false);
      await load(selectedOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleJoinTeam(teamId: string) {
    setJoiningTeamId(teamId);
    try {
      await joinOrgTeam(teamId);
      toast.success("Joined team!");
      await load(selectedOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setJoiningTeamId(null);
    }
  }

  async function handlePromoteToAdmin(userId: string) {
    const orgId = ctx?.org?.id;
    if (!orgId) return;
    try {
      await promoteToAdmin(userId, orgId);
      toast.success("Member promoted to admin");
      await load(selectedOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleRemoveMember(userId: string) {
    const orgId = ctx?.org?.id;
    if (!orgId) return;
    setRemovingMemberId(userId);
    try {
      await removeOrgMember(userId, orgId);
      toast.success("Member removed");
      await load(selectedOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function handleSelectOrg(orgId: string | null) {
    setSelectedOrgId(orgId);
    setLoading(true);
    await load(orgId ?? undefined);
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-sm text-red-500">
          Failed to load organization. Check your connection and try again.
        </p>
        <button
          className="mt-2 text-sm text-primary underline"
          onClick={() => { setLoading(true); load(); }}
        >
          Retry
        </button>
      </div>
    );
  }

  const profile = ctx.profile;
  const isAdmin = profile.role === "admin";
  const canManageTeams = profile.role === "admin" || profile.role === "coach";

  if (ctx.org === null) {
    // Auto-selecting a secondary org — show loading while the useEffect fires
    if (ctxSecondaryOrgs.length > 0 && selectedOrgId === null) {
      return (
        <div className="p-6 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      );
    }
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Organization</h1>
          <p className="mt-1 text-sm text-muted-foreground">You don&apos;t belong to an organization yet.</p>
        </div>
        {profile.isPlatformAdmin && (
          <div className="pt-2">
            <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
              Go to Platform Admin Dashboard →
            </Link>
          </div>
        )}
      </div>
    );
  }

  // Build tab list: primary org first, then secondary orgs
  const primaryOrgId = ctx.profile.orgId;
  const allOrgTabs = [
    ...(primaryOrgId ? [{ orgId: primaryOrgId, orgName: ctx.org?.name ?? "My Org", isNtOrg: ctx.org?.isNtOrg ?? false }] : []),
    ...ctxSecondaryOrgs.map((s) => ({ orgId: s.orgId, orgName: s.orgName, isNtOrg: s.isNtOrg })),
  ];
  const showOrgTabs = allOrgTabs.length > 1;
  const currentOrgTabId = selectedOrgId ?? primaryOrgId ?? null;

  const org = ctx.org;
  const myTeamIds = new Set(ctx.myTeams.map((t) => t.id));
  const otherTeams = ctx.allOrgTeams.filter((t) => !myTeamIds.has(t.id));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {showOrgTabs && (
        <div className="flex gap-1 border-b border-border pb-0 -mb-2">
          {allOrgTabs.map((tab) => (
            <button
              key={tab.orgId}
              type="button"
              onClick={() => handleSelectOrg(tab.orgId === primaryOrgId ? null : tab.orgId)}
              className={cn(
                "px-3 py-2 text-sm font-medium rounded-t-md border border-transparent transition-colors",
                currentOrgTabId === tab.orgId
                  ? "border-border border-b-background bg-background -mb-px text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.orgName}
              {tab.isNtOrg && <span className="ml-1 text-xs opacity-60">NT</span>}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{org.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {ctx.orgMembers.length} member{ctx.orgMembers.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          {canManageTeams && <TabsTrigger value="members">Members</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold">{ctx.allOrgTeams.length}</p>
              <p className="text-xs text-muted-foreground">
                team{ctx.allOrgTeams.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold">{ctx.orgMembers.length}</p>
              <p className="text-xs text-muted-foreground">
                member{ctx.orgMembers.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {/* License info (read-only) */}
          {(org.coachSeatLimit !== null || org.playerSeatLimit !== null || org.expiresAt !== null) && (
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border border-border rounded-md px-3 py-2">
              {(org.coachSeatLimit !== null) && (
                <span>
                  Coaches: <span className="text-foreground font-medium">
                    {ctx.orgMembers.filter((m) => m.role !== "player").length} / {org.coachSeatLimit}
                  </span>
                </span>
              )}
              {(org.playerSeatLimit !== null) && (
                <span>
                  Players: <span className="text-foreground font-medium">
                    {ctx.orgMembers.filter((m) => m.role === "player").length} / {org.playerSeatLimit}
                  </span>
                </span>
              )}
              {org.expiresAt && (
                <span>
                  Expires: <span className="text-foreground font-medium">
                    {new Date(org.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </span>
              )}
            </div>
          )}

          {canManageTeams && <OrgInviteSection orgId={org.id} orgName={org.name} />}
          {profile.isPlatformAdmin && (
            <div className="pt-2">
              <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
                Go to Platform Admin Dashboard →
              </Link>
            </div>
          )}
        </TabsContent>

        <TabsContent value="teams" className="space-y-6 pt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">My Teams</p>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setShowNewTeam((v) => !v)}
                >
                  {showNewTeam ? "Cancel" : "New Team"}
                </Button>
              )}
            </div>
            {showNewTeam && (
              <div className="flex gap-2">
                <Input
                  placeholder="Team name"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                />
                <Input
                  placeholder="Season (optional)"
                  value={newTeamSeason}
                  onChange={(e) => setNewTeamSeason(e.target.value)}
                  className="w-36"
                />
                <Button onClick={handleCreateTeam} disabled={creatingTeam || !newTeamName.trim()}>
                  {creatingTeam ? "Creating…" : "Create"}
                </Button>
              </div>
            )}
            {ctx.myTeams.length === 0 ? (
              <p className="text-sm text-muted-foreground">You&apos;re not in any teams yet.</p>
            ) : (
              <div className="space-y-2">
                {ctx.myTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    memberCount={memberCounts[team.id] ?? 0}
                    userTeamRole={myTeamRoles[team.id] ?? profile.role}
                    canManage={canManageTeams}
                    isAdmin={isAdmin}
                    orgMembers={ctx.orgMembers}
                    onContextReload={load}
                  />
                ))}
              </div>
            )}
          </div>

          {canManageTeams && otherTeams.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Other Teams</p>
              <div className="space-y-2">
                {otherTeams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center justify-between rounded-lg border border-border p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{team.name}</span>
                      {team.season && (
                        <Badge variant="outline" className="text-xs">{team.season}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {memberCounts[team.id] ?? 0} member{(memberCounts[team.id] ?? 0) !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={joiningTeamId === team.id}
                      onClick={() => handleJoinTeam(team.id)}
                    >
                      {joiningTeamId === team.id ? "Joining…" : "Join"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {canManageTeams && (
          <TabsContent value="members" className="pt-4">
            {ctx.orgMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              <div className="space-y-1">
                {ctx.orgMembers.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <div>
                        <span className="text-sm">{m.fullName ?? m.email ?? m.id.slice(0, 8)}</span>
                        {m.fullName && m.email && (
                          <p className="text-xs text-muted-foreground">{m.email}</p>
                        )}
                      </div>
                      <Badge variant={roleBadgeVariant(m.role, m.isPlatformAdmin)} className="text-xs">
                        {m.isPlatformAdmin ? "platform admin" : m.role}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && m.role === "coach" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          onClick={() => handlePromoteToAdmin(m.id)}
                        >
                          Promote to admin
                        </Button>
                      )}
                      {isAdmin && m.id !== profile.id && !m.isPlatformAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          disabled={removingMemberId === m.id}
                          onClick={() => handleRemoveMember(m.id)}
                        >
                          {removingMemberId === m.id ? "Removing…" : "Remove"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
