"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  getOrgContext,
  getOrgContextForOrg,
  getTeamMemberCounts,
  assignMemberToTeam,
  joinOrgTeam,
  promoteToAdmin,
  removeOrgMember,
  removeTeamMember,
  deleteTeam,
} from "@/lib/profile-db";
import { InviteModal } from "@/components/invite-modal";
import { AddMembersToTeamModal } from "@/components/add-members-to-team-modal";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import type { OrgContext, OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, MoreHorizontal, Search, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/auth-context";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleBadgeVariant(
  role: string,
  isPlatformAdmin = false
): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

function memberInitials(m: UserProfile): string {
  return (m.fullName ?? m.email ?? "?")[0].toUpperCase();
}

// ---------------------------------------------------------------------------
// MemberRow
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  isAdmin,
  canManageTeams,
  isMe,
  removingId,
  onPromote,
  onRemove,
}: {
  member: UserProfile;
  isAdmin: boolean;
  canManageTeams: boolean;
  isMe: boolean;
  removingId: string | null;
  onPromote: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const showMenu = isAdmin && !isMe && !member.isPlatformAdmin;
  const removing = removingId === member.id;

  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar size="sm">
          <AvatarImage src={member.avatarUrl ?? undefined} />
          <AvatarFallback>{memberInitials(member)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-sm truncate">{member.fullName ?? member.email ?? member.id.slice(0, 8)}</p>
          {canManageTeams && member.fullName && member.email && (
            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={roleBadgeVariant(member.role, member.isPlatformAdmin)} className="text-xs">
          {member.isPlatformAdmin ? "platform admin" : member.role}
        </Badge>
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={removing}>
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Member actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {member.role === "coach" && (
                <>
                  <DropdownMenuItem onClick={() => onPromote(member.id)}>
                    Promote to admin
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onRemove(member.id)}
              >
                {removing ? "Removing…" : "Remove from org"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
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
  onInvite,
  onAddMembers,
}: {
  team: OrgTeam;
  orgMembers: UserProfile[];
  isAdmin: boolean;
  onContextReload: () => void;
  onInvite: () => void;
  onAddMembers: (memberIds: Set<string>) => void;
}) {
  const [teamMemberDetails, setTeamMemberDetails] = useState<{ userId: string; role: string }[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [removingTeamMemberId, setRemovingTeamMemberId] = useState<string | null>(null);

  const supabase = createClient();

  async function loadCurrentMembers() {
    setLoadingMembers(true);
    try {
      const { data } = await supabase
        .from("team_members")
        .select("user_id, role")
        .eq("team_id", team.id);
      setTeamMemberDetails(
        (data ?? []).map((r: { user_id: string; role: string }) => ({
          userId: r.user_id,
          role: r.role,
        }))
      );
    } finally {
      setLoadingMembers(false);
    }
  }

  useEffect(() => { loadCurrentMembers(); }, [team.id]);

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

  const currentMemberIdSet = new Set(teamMemberDetails.map((m) => m.userId));

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
      {/* Member list */}
      {!loadingMembers && teamMemberDetails.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Members ({teamMemberDetails.length})
          </p>
          {teamMemberDetails.map((tm) => {
            const profile = orgMembers.find((m) => m.id === tm.userId);
            const displayName = profile?.fullName ?? profile?.email ?? tm.userId.slice(0, 8);
            const secondaryText = profile?.fullName && profile?.email ? profile.email : null;
            return (
              <div
                key={tm.userId}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar size="sm">
                    <AvatarImage src={profile?.avatarUrl ?? undefined} />
                    <AvatarFallback>{(displayName[0] ?? "?").toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm truncate">{displayName}</p>
                    {secondaryText && (
                      <p className="text-xs text-muted-foreground truncate">{secondaryText}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={roleBadgeVariant(tm.role)} className="text-xs">{tm.role}</Badge>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      disabled={removingTeamMemberId === tm.userId}
                      onClick={() => handleRemoveTeamMember(tm.userId)}
                    >
                      {removingTeamMemberId === tm.userId ? "Removing…" : "Remove"}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={onInvite}>
          <UserPlus className="h-3.5 w-3.5" />
          Invite to team
        </Button>
        {isAdmin && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => onAddMembers(currentMemberIdSet)}
          >
            Add members
          </Button>
        )}
      </div>
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
  orgId,
  orgName,
  orgTeams,
  orgMembers,
  onContextReload,
  onDelete,
}: {
  team: OrgTeam;
  memberCount: number;
  userTeamRole: string;
  canManage: boolean;
  isAdmin: boolean;
  orgId: string;
  orgName: string;
  orgTeams: OrgTeam[];
  orgMembers: UserProfile[];
  onContextReload: () => void;
  onDelete: (teamId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [currentTeamMemberIds, setCurrentTeamMemberIds] = useState<Set<string>>(new Set());

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center">
        <button
          type="button"
          className="flex-1 flex items-center justify-between p-4 text-left hover:bg-accent/50 transition-colors rounded-lg"
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
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 mr-2 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Team actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(team.id)}
              >
                Delete team
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && canManage && (
        <TeamInviteSection
          team={team}
          orgMembers={orgMembers}
          isAdmin={isAdmin}
          onContextReload={onContextReload}
          onInvite={() => setShowInviteModal(true)}
          onAddMembers={(ids) => {
            setCurrentTeamMemberIds(ids);
            setShowAddMembers(true);
          }}
        />
      )}

      <InviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        orgId={orgId}
        orgName={orgName}
        orgTeams={orgTeams}
        isAdmin={isAdmin}
        initialTeamId={team.id}
      />

      <AddMembersToTeamModal
        open={showAddMembers}
        onClose={() => setShowAddMembers(false)}
        team={team}
        orgMembers={orgMembers}
        currentTeamMemberIds={currentTeamMemberIds}
        onAdded={() => onContextReload()}
      />
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
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [primaryOrgMeta, setPrimaryOrgMeta] = useState<{ name: string; isNtOrg: boolean } | null>(null);

  // Members tab search/filter
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<"" | "admin" | "coach" | "player">("");

  async function load(orgId?: string) {
    try {
      const context = orgId ? await getOrgContextForOrg(orgId) : await getOrgContext();
      setCtx(context);

      if (context.org) {
        const counts = await getTeamMemberCounts(context.org.id);
        setMemberCounts(counts);
        // Capture primary org metadata once (don't overwrite when viewing a secondary org)
        if (!orgId) {
          setPrimaryOrgMeta({ name: context.org.name, isNtOrg: context.org.isNtOrg ?? false });
        }
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

  const ctxSecondaryOrgs = ctx?.secondaryOrgs ?? [];
  useEffect(() => {
    if (!loading && ctx?.org === null && ctxSecondaryOrgs.length > 0 && selectedOrgId === null) {
      handleSelectOrg(ctxSecondaryOrgs[0].orgId);
    }
  }, [loading, ctx?.org, ctxSecondaryOrgs.length]);

  async function handleDeleteTeam(teamId: string) {
    try {
      await deleteTeam(teamId);
      toast.success("Team deleted");
      await load(selectedOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
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

  // Filtered + grouped members
  const filteredMembers = useMemo(() => {
    if (!ctx) return [];
    let list = ctx.orgMembers;
    if (memberRoleFilter) list = list.filter((m) => m.role === memberRoleFilter);
    if (memberSearch.trim()) {
      const q = memberSearch.toLowerCase();
      list = list.filter(
        (m) =>
          m.fullName?.toLowerCase().includes(q) ||
          m.email?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [ctx, memberSearch, memberRoleFilter]);

  // ── Loading / error states ──────────────────────────────────────────────

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

  const org = ctx.org;
  const myTeamIds = new Set(ctx.myTeams.map((t) => t.id));
  const otherTeams = ctx.allOrgTeams.filter((t) => !myTeamIds.has(t.id));

  const primaryOrgId = ctx.profile.orgId;
  const allOrgTabs = [
    ...(primaryOrgId
      ? [{ orgId: primaryOrgId, orgName: primaryOrgMeta?.name ?? org.name, isNtOrg: primaryOrgMeta?.isNtOrg ?? false }]
      : []),
    ...ctxSecondaryOrgs.map((s) => ({ orgId: s.orgId, orgName: s.orgName, isNtOrg: s.isNtOrg })),
  ];
  const showOrgTabs = allOrgTabs.length > 1;
  const currentOrgTabId = selectedOrgId ?? primaryOrgId ?? null;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Org switcher */}
      {showOrgTabs && (
        <div className="flex gap-1 border-b border-border -mb-2">
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

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{org.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {ctx.orgMembers.length} member{ctx.orgMembers.length !== 1 ? "s" : ""}
            {" · "}
            {ctx.allOrgTeams.length} team{ctx.allOrgTeams.length !== 1 ? "s" : ""}
          </p>
        </div>
        {canManageTeams && (
          <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setShowInviteModal(true)}>
            <UserPlus className="h-4 w-4" />
            Invite people
          </Button>
        )}
      </div>

      {/* License banner — admin only */}
      {isAdmin && (org.coachSeatLimit !== null || org.playerSeatLimit !== null || org.expiresAt !== null) && (
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border border-border rounded-md px-3 py-2">
          {org.coachSeatLimit !== null && (
            <span>
              Coaches:{" "}
              <span className="text-foreground font-medium">
                {ctx.orgMembers.filter((m) => m.role !== "player").length} / {org.coachSeatLimit}
              </span>
            </span>
          )}
          {org.playerSeatLimit !== null && (
            <span>
              Players:{" "}
              <span className="text-foreground font-medium">
                {ctx.orgMembers.filter((m) => m.role === "player").length} / {org.playerSeatLimit}
              </span>
            </span>
          )}
          {org.expiresAt && (
            <span>
              Expires:{" "}
              <span className="text-foreground font-medium">
                {new Date(org.expiresAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Platform admin link */}
      {profile.isPlatformAdmin && (
        <Link
          href="/admin"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Go to Platform Admin Dashboard →
        </Link>
      )}

      <Tabs defaultValue="teams">
        <TabsList>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        {/* ── Teams ── */}
        <TabsContent value="teams" className="space-y-6 pt-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">My Teams</p>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setShowCreateTeam(true)}
                >
                  New Team
                </Button>
              )}
            </div>
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
                    orgId={org.id}
                    orgName={org.name}
                    orgTeams={ctx.allOrgTeams}
                    orgMembers={ctx.orgMembers}
                    onContextReload={() => load(selectedOrgId ?? undefined)}
                    onDelete={handleDeleteTeam}
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

        {/* ── Members ── */}
        <TabsContent value="members" className="space-y-4 pt-4">
          {/* Search + filter — admin/coach only */}
          {canManageTeams && (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search members…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </div>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={memberRoleFilter}
                onChange={(e) => setMemberRoleFilter(e.target.value as typeof memberRoleFilter)}
              >
                <option value="">All roles</option>
                <option value="admin">Admins</option>
                <option value="coach">Coaches</option>
                <option value="player">Players</option>
              </select>
            </div>
          )}

          {ctx.orgMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : filteredMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members match your search.</p>
          ) : (
            <div className="space-y-4">
              {(["admin", "coach", "player"] as const).map((role) => {
                const group = filteredMembers.filter((m) => m.role === role);
                if (group.length === 0) return null;
                const label = role === "admin" ? "Admins" : role === "coach" ? "Coaches" : "Players";
                return (
                  <div key={role} className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                      {label} ({group.length})
                    </p>
                    {group.map((m) => (
                      <MemberRow
                        key={m.id}
                        member={m}
                        isAdmin={isAdmin}
                        canManageTeams={canManageTeams}
                        isMe={m.id === profile.id}
                        removingId={removingMemberId}
                        onPromote={handlePromoteToAdmin}
                        onRemove={handleRemoveMember}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <InviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        orgId={org.id}
        orgName={org.name}
        orgTeams={ctx.allOrgTeams}
        isAdmin={isAdmin}
      />

      <CreateTeamDialog
        open={showCreateTeam}
        onClose={() => setShowCreateTeam(false)}
        onCreated={() => load(selectedOrgId ?? undefined)}
        orgId={selectedOrgId ?? undefined}
      />
    </div>
  );
}
