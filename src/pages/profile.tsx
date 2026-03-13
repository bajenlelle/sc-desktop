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
  createOrg,
  createTeam,
  generateInviteCode,
  listInvitesForTeam,
  deleteInvite,
  joinTeamByCode,
  getTeamMemberCounts,
  generateOrgInviteCode,
  listOrgInvites,
  deleteOrgInvite,
  joinOrgByCode,
  assignMemberToTeam,
  joinOrgTeam,
} from "@/lib/profile-db";
import type { OrgContext, OrgTeam, TeamInvite, OrgInvite, UserProfile } from "@/types/org";
import { toast } from "sonner";
import { Clipboard, Check, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "coach") return "secondary";
  return "outline";
}

// ---------------------------------------------------------------------------
// OrgInviteSection: org-level invite codes (admin only)
// ---------------------------------------------------------------------------

function OrgInviteSection({ orgId }: { orgId: string }) {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    setLoadingInvites(true);
    try {
      setInvites(await listOrgInvites(orgId));
    } finally {
      setLoadingInvites(false);
    }
  }

  async function handleGenerate(role: "coach" | "player") {
    try {
      await generateOrgInviteCode(orgId, role);
      toast.success(`${role === "coach" ? "Coach" : "Player"} org invite code generated`);
      if (expanded) load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete(inviteId: string) {
    try {
      await deleteOrgInvite(inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function handleCopy(code: string, id: string) {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function toggleExpanded() {
    if (!expanded) load();
    setExpanded((v) => !v);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Invite to Organization</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerate("coach")}>
            Invite Coach
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerate("player")}>
            Invite Player
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={toggleExpanded}>
            {expanded ? "Hide codes" : "Show codes"}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2">
          {loadingInvites ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : invites.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active org invite codes.</p>
          ) : (
            invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs shrink-0">{inv.role}</Badge>
                <Input
                  readOnly
                  value={inv.code}
                  className="h-7 font-mono text-sm flex-1"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => handleCopy(inv.code, inv.id)}
                  title="Copy code"
                >
                  {copiedId === inv.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Clipboard className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-500"
                  onClick={() => handleDelete(inv.id)}
                  title="Delete invite"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamSection: invite code list + generate for one team
// ---------------------------------------------------------------------------

function TeamSection({
  team,
  memberCount,
  onInviteGenerated,
  orgMembers,
  onContextReload,
}: {
  team: OrgTeam;
  memberCount: number;
  onInviteGenerated: () => void;
  orgMembers: UserProfile[];
  onContextReload: () => void;
}) {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add member state
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
    } finally {
      setLoadingInvites(false);
    }
  }

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

  async function handleGenerate(role: "coach" | "player") {
    try {
      await generateInviteCode(team.id, role);
      toast.success(`${role === "coach" ? "Coach" : "Player"} invite code generated`);
      onInviteGenerated();
      if (expanded) load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete(inviteId: string) {
    try {
      await deleteInvite(inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function handleCopy(code: string, id: string) {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function toggleExpanded() {
    if (!expanded) load();
    setExpanded((v) => !v);
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

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-sm">{team.name}</span>
          {team.season && (
            <Badge variant="outline" className="ml-2 text-xs">{team.season}</Badge>
          )}
          <span className="ml-2 text-xs text-muted-foreground">{memberCount} member{memberCount !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerate("coach")}>
            Invite Coach
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleGenerate("player")}>
            Invite Player
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={toggleAddMember}>
            {showAddMember ? "Cancel" : "Add Member"}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={toggleExpanded}>
            {expanded ? "Hide codes" : "Show codes"}
          </Button>
        </div>
      </div>

      {showAddMember && (
        <div className="flex items-center gap-2 pt-1">
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

      {expanded && (
        <div className="space-y-2">
          {loadingInvites ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : invites.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active invite codes.</p>
          ) : (
            invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs shrink-0">{inv.role}</Badge>
                <Input
                  readOnly
                  value={inv.code}
                  className="h-7 font-mono text-sm flex-1"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => handleCopy(inv.code, inv.id)}
                  title="Copy code"
                >
                  {copiedId === inv.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Clipboard className="h-3.5 w-3.5" />}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-500"
                  onClick={() => handleDelete(inv.id)}
                  title="Delete invite"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfilePage
// ---------------------------------------------------------------------------

export function ProfilePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Personal info form
  const [fullName, setFullName] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Create org form
  const [orgName, setOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);

  // Create team form
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamSeason, setNewTeamSeason] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);

  // Join org by code
  const [joinOrgCode, setJoinOrgCode] = useState("");
  const [joiningOrg, setJoiningOrg] = useState(false);
  const [joinOrgError, setJoinOrgError] = useState<string | null>(null);

  // Join team
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null);

  // Member counts for teams
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});

  async function load() {
    try {
      const context = await getOrgContext();
      setCtx(context);
      setFullName(context.profile.fullName ?? "");
      setAvatarPreview(context.profile.avatarUrl ?? null);
      if (context.allOrgTeams.length > 0) {
        const counts = await getTeamMemberCounts(context.allOrgTeams.map((t) => t.id));
        setMemberCounts(counts);
      }
    } catch (e) {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Avatar must be under 5 MB");
      return;
    }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function handleSaveProfile() {
    setSaving(true);
    try {
      let avatarUrl: string | undefined;
      if (avatarFile) {
        avatarUrl = await uploadAvatar(avatarFile);
      }
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

  async function handleCreateOrg() {
    if (!orgName.trim()) return;
    setCreatingOrg(true);
    try {
      await createOrg(orgName.trim());
      toast.success("Organization created");
      setOrgName("");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreatingOrg(false);
    }
  }

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

  async function handleJoinOrg() {
    if (joinOrgCode.length !== 6) return;
    setJoiningOrg(true);
    setJoinOrgError(null);
    try {
      await joinOrgByCode(joinOrgCode);
      toast.success("Joined organization!");
      setJoinOrgCode("");
      await load();
    } catch (e) {
      setJoinOrgError((e as Error).message);
    } finally {
      setJoiningOrg(false);
    }
  }

  async function handleJoin() {
    if (joinCode.length !== 6) return;
    setJoining(true);
    setJoinError(null);
    try {
      await joinTeamByCode(joinCode);
      toast.success("Joined team!");
      setJoinCode("");
      await load();
    } catch (e) {
      setJoinError((e as Error).message);
    } finally {
      setJoining(false);
    }
  }

  async function handleJoinOrgTeam(teamId: string) {
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

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-sm text-red-500">Failed to load profile. Check your connection and try again.</p>
        <button className="mt-2 text-sm text-primary underline" onClick={() => { setLoading(true); load(); }}>
          Retry
        </button>
      </div>
    );
  }

  const profile = ctx.profile;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your identity, organization, and teams.</p>
      </div>

      {/* Personal Info */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-foreground">Personal Info</h2>
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="relative h-16 w-16 rounded-full overflow-hidden bg-primary/15 flex items-center justify-center text-lg font-semibold text-primary hover:opacity-80 transition-opacity"
              onClick={() => fileInputRef.current?.click()}
              title="Change avatar"
            >
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <span>{(fullName || user?.email || "?").slice(0, 2).toUpperCase()}</span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFileChange}
            />
            <div className="flex-1 space-y-1">
              <p className="text-xs text-muted-foreground">Click avatar to change. Max 5 MB.</p>
              <Badge variant={roleBadgeVariant(profile.role)}>{profile.role}</Badge>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Organization */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-foreground">Organization</h2>

          {ctx.org === null ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">You don't belong to an organization yet.</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Organization name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
                />
                <Button onClick={handleCreateOrg} disabled={creatingOrg || !orgName.trim()}>
                  {creatingOrg ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{ctx.org.name}</p>
                  <p className="text-xs text-muted-foreground">{ctx.allOrgTeams.length} team{ctx.allOrgTeams.length !== 1 ? "s" : ""}</p>
                </div>
                {profile.role === "admin" && (
                  <Button size="sm" variant="outline" onClick={() => setShowNewTeam((v) => !v)}>
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

              {profile.role === "admin" && ctx.org && (
                <OrgInviteSection orgId={ctx.org.id} />
              )}

              {ctx.allOrgTeams.length > 0 && (
                <div className="space-y-2">
                  {ctx.allOrgTeams.map((team) => (
                    <TeamSection
                      key={team.id}
                      team={team}
                      memberCount={memberCounts[team.id] ?? 0}
                      onInviteGenerated={() => {}}
                      orgMembers={profile.role === "admin" ? ctx.orgMembers : []}
                      onContextReload={load}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Join Organization / Team */}
      <Card>
        <CardContent className="space-y-4 p-6">
          {ctx.profile.orgId === null ? (
            <>
              <h2 className="text-base font-semibold text-foreground">Join an Organization</h2>
              <p className="text-sm text-muted-foreground">Enter a 6-character org invite code to join an organization.</p>
              <div className="flex gap-2">
                <Input
                  placeholder="ABC123"
                  value={joinOrgCode}
                  onChange={(e) => setJoinOrgCode(e.target.value.toUpperCase().slice(0, 6))}
                  onKeyDown={(e) => e.key === "Enter" && handleJoinOrg()}
                  className="font-mono uppercase w-32"
                  maxLength={6}
                />
                <Button onClick={handleJoinOrg} disabled={joiningOrg || joinOrgCode.length !== 6}>
                  {joiningOrg ? "Joining…" : "Join"}
                </Button>
              </div>
              {joinOrgError && <p className="text-sm text-red-500">{joinOrgError}</p>}

              <div className="border-t border-border pt-4">
                <h2 className="text-base font-semibold text-foreground">Join a Team</h2>
                <p className="mt-1 mb-3 text-sm text-muted-foreground">Enter a 6-character team invite code.</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="ABC123"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                    className="font-mono uppercase w-32"
                    maxLength={6}
                  />
                  <Button onClick={handleJoin} disabled={joining || joinCode.length !== 6}>
                    {joining ? "Joining…" : "Join"}
                  </Button>
                </div>
                {joinError && <p className="text-sm text-red-500">{joinError}</p>}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-foreground">Join a Team</h2>
              {(() => {
                const myTeamIds = new Set(ctx.myTeams.map((t) => t.id));
                const availableTeams = ctx.allOrgTeams.filter((t) => !myTeamIds.has(t.id));
                return availableTeams.length === 0 ? (
                  <p className="text-sm text-muted-foreground">You're already in all teams in your organization.</p>
                ) : (
                  <div className="space-y-2">
                    {availableTeams.map((team) => (
                      <div key={team.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div>
                          <span className="text-sm font-medium">{team.name}</span>
                          {team.season && (
                            <Badge variant="outline" className="ml-2 text-xs">{team.season}</Badge>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={joiningTeamId === team.id}
                          onClick={() => handleJoinOrgTeam(team.id)}
                        >
                          {joiningTeamId === team.id ? "Joining…" : "Join"}
                        </Button>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium text-foreground mb-2">Join by invite code</p>
                <p className="text-xs text-muted-foreground mb-3">Use a team invite code to join a team directly.</p>
                <div className="flex gap-2">
                  <Input
                    placeholder="ABC123"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                    onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                    className="font-mono uppercase w-32"
                    maxLength={6}
                  />
                  <Button onClick={handleJoin} disabled={joining || joinCode.length !== 6}>
                    {joining ? "Joining…" : "Join"}
                  </Button>
                </div>
                {joinError && <p className="text-sm text-red-500">{joinError}</p>}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold text-foreground">Account</h2>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email ?? ""} readOnly className="text-muted-foreground" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleChangePassword}>
              Change password
            </Button>
            <Button variant="ghost" className="text-muted-foreground" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
