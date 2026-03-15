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
  createOrgForPlatform,
  generateAdminOrgInviteCode,
  getAllOrgsWithCounts,
} from "@/lib/profile-db";
import type { OrgContext, OrgTeam, TeamInvite, OrgInvite, UserProfile, OrgWithCount } from "@/types/org";
import { toast } from "sonner";
import { Clipboard, Check, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
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

  function handleCopy() {
    if (!code) return;
    navigator.clipboard.writeText(`Join ${entityName} on Scoutable — Code: ${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              {copied ? "Copied!" : "Copy Invite"}
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
  const [selectedRole, setSelectedRole] = useState<"coach" | "player">("player");
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
    setAddingMember(true);
    try {
      await assignMemberToTeam(selectedUserId, team.id, selectedRole);
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
                  <select
                    className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as "coach" | "player")}
                  >
                    <option value="player">Player</option>
                    <option value="coach">Coach</option>
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
// PlatformAdminSection
// ---------------------------------------------------------------------------

function PlatformAdminSection() {
  const [orgs, setOrgs] = useState<OrgWithCount[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<Record<string, string>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [copiedOrgId, setCopiedOrgId] = useState<string | null>(null);

  async function loadOrgs() {
    try {
      setOrgs(await getAllOrgsWithCounts());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  useEffect(() => { loadOrgs(); }, []);

  async function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    try {
      await createOrgForPlatform(newOrgName.trim());
      toast.success("Organization created");
      setNewOrgName("");
      await loadOrgs();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreatingOrg(false);
    }
  }

  async function handleGenerateAdminInvite(orgId: string) {
    setGeneratingId(orgId);
    try {
      const code = await generateAdminOrgInviteCode(orgId);
      setGeneratedCodes((prev) => ({ ...prev, [orgId]: code }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGeneratingId(null);
    }
  }

  function handleCopy(code: string, orgId: string) {
    navigator.clipboard.writeText(code);
    setCopiedOrgId(orgId);
    setTimeout(() => setCopiedOrgId(null), 2000);
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-base font-semibold text-foreground">Platform Admin</h2>

        <div className="flex gap-2">
          <Input
            placeholder="New organization name"
            value={newOrgName}
            onChange={(e) => setNewOrgName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
          />
          <Button onClick={handleCreateOrg} disabled={creatingOrg || !newOrgName.trim()}>
            {creatingOrg ? "Creating…" : "Create Org"}
          </Button>
        </div>

        {orgs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No organizations yet.</p>
        ) : (
          <div className="space-y-2">
            {orgs.map((org) => (
              <div key={org.id} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{org.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {org.memberCount} member{org.memberCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={generatingId === org.id}
                    onClick={() => handleGenerateAdminInvite(org.id)}
                  >
                    {generatingId === org.id ? "Generating…" : "Generate Admin Invite"}
                  </Button>
                </div>
                {generatedCodes[org.id] && (
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={generatedCodes[org.id]}
                      className="h-7 font-mono text-sm flex-1"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => handleCopy(generatedCodes[org.id], org.id)}
                      title="Copy code"
                    >
                      {copiedOrgId === org.id
                        ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                        : <Clipboard className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
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
        {profile.isPlatformAdmin && <PlatformAdminSection />}
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

          {/* Org-level invite codes */}
          {canManageTeams && (
            <OrgInviteSection orgId={org.id} orgName={org.name} />
          )}

          {/* Platform admin */}
          {profile.isPlatformAdmin && <PlatformAdminSection />}
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
