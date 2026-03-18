import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getOrgContext,
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
} from "@/lib/profile-db";
import type { OrgContext, OrgTeam, TeamInvite, OrgInvite, UserProfile } from "@/types/org";
import { toast } from "sonner";
import { Clipboard, Check, RefreshCw, ChevronDown, ChevronUp, Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleBadgeVariant(role: string, isPlatformAdmin = false): "default" | "secondary" | "outline" | "destructive" {
  if (isPlatformAdmin) return "destructive";
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

// ---------------------------------------------------------------------------
// InviteCard — one active code per role, always visible
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
    navigator.clipboard.writeText(`https://scoutable.app/join/${code}`);
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
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onRegenerate} disabled={regenerating}>
            {regenerating ? "Generating…" : "Generate Code"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// OrgInviteSection — org-level invite cards (coach + player)
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
// TeamInviteSection — team-level invite cards + add member
// ---------------------------------------------------------------------------

function TeamInviteSection({
  team,
  orgMembers,
  onContextReload,
}: {
  team: OrgTeam;
  orgMembers: UserProfile[];
  onContextReload: () => void;
}) {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);
  const [regeneratingRole, setRegeneratingRole] = useState<string | null>(null);

  const [showAddMember, setShowAddMember] = useState(false);
  const [currentMemberIds, setCurrentMemberIds] = useState<Set<string>>(new Set());
  const [loadingMembers, setLoadingMembers] = useState(false);
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

  useEffect(() => { load(); }, [team.id]);

  async function loadCurrentMembers() {
    setLoadingMembers(true);
    try {
      const { data } = await supabase
        .from("team_members")
        .select("user_id")
        .eq("team_id", team.id);
      setCurrentMemberIds(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
    } finally {
      setLoadingMembers(false);
    }
  }

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

  function toggleAddMember() {
    if (!showAddMember) {
      loadCurrentMembers();
      setSelectedUserId("");
    }
    setShowAddMember((v) => !v);
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
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAddingMember(false);
    }
  }

  const availableToAdd = orgMembers.filter((m) => !currentMemberIds.has(m.id));
  const coachInvite = invites.find((i) => i.role === "coach");
  const playerInvite = invites.find((i) => i.role === "player");

  if (loadingInvites) {
    return <p className="text-xs text-muted-foreground px-4 pb-3">Loading invite codes…</p>;
  }

  return (
    <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
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

      {orgMembers.length > 0 && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={toggleAddMember}>
            {showAddMember ? "Cancel" : "Add Member"}
          </Button>
          {showAddMember && (
            <div className="flex items-center gap-2">
              {loadingMembers ? (
                <p className="text-xs text-muted-foreground">Loading members…</p>
              ) : availableToAdd.length === 0 ? (
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
                        {m.fullName ?? m.id.slice(0, 8)} ({m.role})
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
// TeamCard — expandable card for My Teams
// ---------------------------------------------------------------------------

function TeamCard({
  team,
  memberCount,
  userTeamRole,
  canManage,
  orgMembers,
  onContextReload,
}: {
  team: OrgTeam;
  memberCount: number;
  userTeamRole: string;
  canManage: boolean;
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
        <TeamInviteSection team={team} orgMembers={orgMembers} onContextReload={onContextReload} />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// OrganizationPage
// ---------------------------------------------------------------------------

export function OrganizationPage() {
  const { user } = useAuth();
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [myTeamRoles, setMyTeamRoles] = useState<Record<string, string>>({});
  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  // New team form (admin only)
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSeason, setNewTeamSeason] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  async function load() {
    try {
      const context = await getOrgContext();
      setCtx(context);

      if (context.allOrgTeams.length > 0) {
        const counts = await getTeamMemberCounts(context.allOrgTeams.map((t) => t.id));
        setMemberCounts(counts);
      }

      // Load user's role in each team
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

  async function handleCreateTeam() {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      await createTeam(newTeamName.trim(), newTeamSeason.trim() || undefined);
      toast.success("Team created");
      setNewTeamName("");
      setNewTeamSeason("");
      setShowNewTeam(false);
      await load();
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
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setJoiningTeamId(null);
    }
  }

  async function handlePromoteToAdmin(userId: string) {
    try {
      await promoteToAdmin(userId);
      toast.success("Member promoted to admin");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleRemoveMember(userId: string) {
    setRemovingMemberId(userId);
    try {
      await removeOrgMember(userId);
      toast.success("Member removed");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingMemberId(null);
    }
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
        <p className="text-sm text-red-500">Failed to load organization. Check your connection and try again.</p>
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
  const isCoach = profile.role === "coach";
  const isPlayer = profile.role === "player";
  const canManageTeams = isAdmin || isCoach;

  if (ctx.org === null) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Organization</h1>
          <p className="mt-1 text-sm text-muted-foreground">You don't belong to an organization yet.</p>
        </div>
        {profile.isPlatformAdmin && (
          <p className="text-sm text-muted-foreground">
            Manage organizations from the Scoutable web app →{" "}
            <span className="font-mono text-foreground">scoutable.app/admin</span>
          </p>
        )}
      </div>
    );
  }

  const org = ctx.org;
  const myTeamIds = new Set(ctx.myTeams.map((t) => t.id));
  const otherTeams = ctx.allOrgTeams.filter((t) => !myTeamIds.has(t.id));

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
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

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-6 pt-4">
          {/* Stats */}
          <div className="flex gap-6">
            <div>
              <p className="text-2xl font-bold">{ctx.allOrgTeams.length}</p>
              <p className="text-xs text-muted-foreground">team{ctx.allOrgTeams.length !== 1 ? "s" : ""}</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{ctx.orgMembers.length}</p>
              <p className="text-xs text-muted-foreground">member{ctx.orgMembers.length !== 1 ? "s" : ""}</p>
            </div>
          </div>

          {/* License info (read-only) */}
          {(org.coachSeatLimit !== null || org.playerSeatLimit !== null || org.expiresAt !== null) && (
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border border-border rounded-md px-3 py-2">
              {org.coachSeatLimit !== null && (
                <span>
                  Coaches: <span className="text-foreground font-medium">
                    {ctx.orgMembers.filter((m) => m.role !== "player").length} / {org.coachSeatLimit}
                  </span>
                </span>
              )}
              {org.playerSeatLimit !== null && (
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

          {/* Org-level invite codes */}
          {canManageTeams && (
            <OrgInviteSection orgId={org.id} orgName={org.name} />
          )}

          {/* Platform admin link */}
          {profile.isPlatformAdmin && (
            <p className="text-sm text-muted-foreground">
              Manage organizations from the Scoutable web app →{" "}
              <span className="font-mono text-foreground">scoutable.app/admin</span>
            </p>
          )}
        </TabsContent>

        {/* ── Teams ── */}
        <TabsContent value="teams" className="space-y-6 pt-4">
          {/* My Teams */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">My Teams</p>
              {isAdmin && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNewTeam((v) => !v)}>
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
                <Button
                  onClick={handleCreateTeam}
                  disabled={creatingTeam || !newTeamName.trim()}
                >
                  {creatingTeam ? "Creating…" : "Create"}
                </Button>
              </div>
            )}

            {ctx.myTeams.length === 0 ? (
              <p className="text-sm text-muted-foreground">You're not in any teams yet.</p>
            ) : (
              <div className="space-y-2">
                {ctx.myTeams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    memberCount={memberCounts[team.id] ?? 0}
                    userTeamRole={myTeamRoles[team.id] ?? profile.role}
                    canManage={canManageTeams}
                    orgMembers={isAdmin ? ctx.orgMembers : []}
                    onContextReload={load}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Other Teams — coaches/admins only */}
          {canManageTeams && otherTeams.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Other Teams</p>
              <div className="space-y-2">
                {otherTeams.map((team) => (
                  <div key={team.id} className="flex items-center justify-between rounded-lg border border-border p-4">
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
                      <span className="text-sm">{m.fullName ?? m.id.slice(0, 8)}</span>
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
