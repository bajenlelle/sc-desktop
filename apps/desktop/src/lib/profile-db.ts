/**
 * Database operations for profiles, organizations, teams, and team membership.
 * All queries run through the browser Supabase client — RLS enforces ownership.
 */

import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@scoutable/shared/lib/current-user";
import type { UserProfile, Organization, OrgTeam, TeamMember, TeamInvite, OrgInvite, OrgContext, OrgWithCount, OrgMembership, SecondaryOrg, OrgPlanTier, InviteInvalidReason } from "@/types/org";

// ---------------------------------------------------------------------------
// Row types (snake_case Postgres columns)
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  org_id: string | null;
  created_at: string;
  is_platform_admin: boolean;
  email?: string | null;
  celebrated_plan_tier?: string | null;
  onboarding_checklist_dismissed_at?: string | null;
  welcome_dismissed_at?: string | null;
  declared_role?: string | null;
}

interface OrgMemberRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  role: string;
  joined_at: string;
}

interface OrgRow {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  coach_seat_limit: number | null;
  player_seat_limit: number | null;
  expires_at: string | null;
  is_nt_org?: boolean;
  plan_tier?: string;
}

interface TeamRow {
  id: string;
  org_id: string;
  name: string;
  sport: string;
  season: string | null;
  created_at: string;
}

interface TeamMemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

interface TeamInviteRow {
  id: string;
  team_id: string;
  code: string;
  role: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number | null;
}

interface OrgInviteRow {
  id: string;
  org_id: string;
  code: string;
  role: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number | null;
  is_national_team: boolean;
  team_id: string | null;
  email: string | null;
}

// ---------------------------------------------------------------------------
// Row converters
// ---------------------------------------------------------------------------

function rowToProfile(r: ProfileRow): UserProfile {
  return {
    id: r.id,
    fullName: r.full_name,
    email: (r as any).email ?? null,
    avatarUrl: r.avatar_url,
    role: r.role as UserProfile['role'],
    orgId: r.org_id,
    createdAt: r.created_at,
    isPlatformAdmin: r.is_platform_admin ?? false,
    celebratedPlanTier: (r.celebrated_plan_tier as 'rookie' | 'pro' | null | undefined) ?? null,
    onboardingChecklistDismissedAt: r.onboarding_checklist_dismissed_at ?? null,
    welcomeDismissedAt: r.welcome_dismissed_at ?? null,
    declaredRole: (r.declared_role as 'coach' | 'player' | null | undefined) ?? null,
  };
}

function rowToOrgMember(r: OrgMemberRow): UserProfile {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    avatarUrl: r.avatar_url,
    role: r.role as UserProfile['role'],
    orgId: null,
    createdAt: r.joined_at,
    isPlatformAdmin: false,
  };
}

function rowToOrg(r: OrgRow): Organization {
  return {
    id: r.id,
    name: r.name,
    logoUrl: r.logo_url,
    createdAt: r.created_at,
    coachSeatLimit: r.coach_seat_limit ?? null,
    playerSeatLimit: r.player_seat_limit ?? null,
    expiresAt: r.expires_at ?? null,
    isNtOrg: r.is_nt_org ?? false,
    planTier: (r.plan_tier ?? 'free') as OrgPlanTier,
  };
}

function rowToTeam(r: TeamRow): OrgTeam {
  return { id: r.id, orgId: r.org_id, name: r.name, sport: r.sport, season: r.season, createdAt: r.created_at };
}

function rowToMember(r: TeamMemberRow): TeamMember {
  return { id: r.id, teamId: r.team_id, userId: r.user_id, role: r.role as TeamMember['role'], joinedAt: r.joined_at };
}

function rowToInvite(r: TeamInviteRow): TeamInvite {
  return {
    id: r.id, teamId: r.team_id, code: r.code,
    role: r.role as TeamInvite['role'], createdBy: r.created_by,
    createdAt: r.created_at, expiresAt: r.expires_at,
    usedCount: r.used_count, maxUses: r.max_uses,
  };
}

function rowToOrgInvite(r: OrgInviteRow): OrgInvite {
  return {
    id: r.id, orgId: r.org_id, code: r.code,
    role: r.role as OrgInvite['role'], createdBy: r.created_by,
    createdAt: r.created_at, expiresAt: r.expires_at,
    usedCount: r.used_count, maxUses: r.max_uses,
    isNationalTeam: r.is_national_team ?? false,
    teamId: r.team_id ?? null,
    email: r.email ?? null,
  };
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getMyProfile(userId: string): Promise<UserProfile> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin, celebrated_plan_tier, onboarding_checklist_dismissed_at, welcome_dismissed_at, declared_role")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error(`Failed to load profile: ${error?.message}`);
  return rowToProfile(data as ProfileRow);
}

/** Record the user's self-declared role (copy/analytics only, not permissions). */
export async function setDeclaredRole(role: 'coach' | 'player'): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("profiles")
    .update({ declared_role: role })
    .eq("id", user.id);
  if (error) throw new Error(`Failed to set role: ${error.message}`);
}

/** Hide the Getting Started checklist permanently (across devices). */
export async function dismissOnboardingChecklist(): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("profiles")
    .update({ onboarding_checklist_dismissed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) throw new Error(`Failed to dismiss checklist: ${error.message}`);
}

/** Hide the first-visit welcome surfaces permanently (across devices & apps). */
export async function dismissWelcome(): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("profiles")
    .update({ welcome_dismissed_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) throw new Error(`Failed to dismiss welcome: ${error.message}`);
}

/**
 * Record that the one-time upgrade celebration was shown for this tier, so
 * no other device or app (web/desktop) shows it again.
 */
export async function markPlanCelebrated(tier: 'rookie' | 'pro'): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("profiles")
    .update({ celebrated_plan_tier: tier })
    .eq("id", user.id);
  if (error) throw new Error(`Failed to mark plan celebrated: ${error.message}`);
}

export async function updateMyProfile(patch: { fullName?: string; avatarUrl?: string }): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (Object.keys(row).length === 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("profiles").update(row).eq("id", user.id);
  if (error) throw new Error(`Failed to update profile: ${error.message}`);
}

export async function uploadAvatar(file: File): Promise<string> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${user.id}/avatar.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw new Error(`Failed to upload avatar: ${error.message}`);
  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  // Strip cache-busting query params before saving
  return urlData.publicUrl.split("?")[0];
}

// ---------------------------------------------------------------------------
// Org context (loads everything needed for the profile page)
// ---------------------------------------------------------------------------

/**
 * Org context for the user's primary org, plus their teams across every org.
 *
 * Two waves, not five: only the org-scoped reads genuinely depend on the
 * profile (for org_id), and only the other-org team read depends on myOrgs.
 * team_members and get_my_orgs need nothing but the uid, so they ride in the
 * first wave rather than trailing it.
 */
export async function getOrgContext(): Promise<OrgContext> {
  const supabase = createClient();
  const uid = await currentUserId(supabase);
  if (!uid) throw new Error("Not authenticated");

  // Wave 1 — everything that needs only the uid.
  const [profileRes, membershipsRes, myOrgs] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin")
      .eq("id", uid)
      .single(),
    supabase
      .from("team_members")
      .select("id, team_id, user_id, role, joined_at")
      .eq("user_id", uid),
    getMyOrgs(),
  ]);
  if (profileRes.error || !profileRes.data) throw new Error(`Failed to load profile: ${profileRes.error?.message}`);
  const baseProfile = rowToProfile(profileRes.data as ProfileRow);

  // Wave 2 — the org-scoped reads, plus teams from the user's other orgs.
  const primaryOrgId = baseProfile.orgId;
  const otherOrgIds = myOrgs.filter((o) => o.orgId !== primaryOrgId).map((o) => o.orgId);
  const [orgRes, teamsRes, membersRes, otherTeamsRes] = await Promise.all([
    primaryOrgId
      ? supabase.from("organizations").select("id, name, logo_url, created_at, coach_seat_limit, player_seat_limit, expires_at, is_nt_org, plan_tier").eq("id", primaryOrgId).single()
      : null,
    primaryOrgId
      ? supabase.from("teams").select("id, org_id, name, sport, season, created_at").eq("org_id", primaryOrgId)
      : null,
    primaryOrgId ? supabase.rpc("get_org_members", { p_org_id: primaryOrgId }) : null,
    otherOrgIds.length > 0
      ? supabase.from("teams").select("id, org_id, name, sport, season, created_at").in("org_id", otherOrgIds)
      : null,
  ]);

  const org: Organization | null = orgRes?.data ? rowToOrg(orgRes.data as OrgRow) : null;
  const allOrgTeams: OrgTeam[] = teamsRes?.data ? (teamsRes.data as TeamRow[]).map(rowToTeam) : [];
  const orgMembers: UserProfile[] = membersRes?.data ? (membersRes.data as OrgMemberRow[]).map(rowToOrgMember) : [];
  const otherOrgTeams: OrgTeam[] = otherTeamsRes?.data ? (otherTeamsRes.data as TeamRow[]).map(rowToTeam) : [];

  // Use org_memberships role as the authoritative role (profiles.role may be stale)
  const myMembership = orgMembers.find((m) => m.id === uid);
  const profile: UserProfile = { ...baseProfile, role: (myMembership?.role ?? baseProfile.role) as UserProfile["role"] };

  const memberTeamIds = new Set(
    membershipsRes.error ? [] : (membershipsRes.data ?? []).map((m: TeamMemberRow) => m.team_id)
  );
  const myTeams = [
    ...allOrgTeams.filter((t) => memberTeamIds.has(t.id)),
    ...otherOrgTeams.filter((t) => memberTeamIds.has(t.id)),
  ];

  return { profile, org, myTeams, allOrgTeams, orgMembers, myOrgs, secondaryOrgs: myOrgs };
}

export async function getOrgMembers(orgId: string): Promise<UserProfile[]> {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_org_members", { p_org_id: orgId });
  return data ? (data as OrgMemberRow[]).map(rowToOrgMember) : [];
}

export async function getMyOrgs(): Promise<OrgMembership[]> {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_my_orgs");
  return (data ?? []).map((r: { org_id: string; org_name: string; role: string; is_nt_org: boolean; plan_tier: string; is_personal: boolean; expires_at?: string | null }) => ({
    orgId: r.org_id,
    orgName: r.org_name,
    role: r.role as OrgMembership['role'],
    isNtOrg: r.is_nt_org,
    planTier: (r.plan_tier ?? 'free') as OrgPlanTier,
    isPersonal: r.is_personal ?? false,
    expiresAt: r.expires_at ?? null,
  }));
}

/** @deprecated Use getMyOrgs */
export async function getMySecondaryOrgs(): Promise<OrgMembership[]> {
  return getMyOrgs();
}

/**
 * Full org context for one org. Every query depends only on (uid, orgId), so
 * they all go in one batch — the team_members lookup and get_my_orgs used to
 * run as two extra serial waves, making this four round trips deep.
 *
 * Pass `myOrgs` when the caller already has it (the auth context resolves it
 * at sign-in) to skip the get_my_orgs round trip.
 */
export async function getOrgContextForOrg(
  orgId: string,
  opts?: { myOrgs?: OrgMembership[] },
): Promise<OrgContext> {
  const supabase = createClient();
  const uid = await currentUserId(supabase);
  if (!uid) throw new Error("Not authenticated");

  const [profileRes, orgRes, teamsRes, membersRes, membershipsRes, myOrgs] = await Promise.all([
    supabase.from("profiles").select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin").eq("id", uid).single(),
    supabase.from("organizations").select("id, name, logo_url, created_at, coach_seat_limit, player_seat_limit, expires_at, is_nt_org, plan_tier").eq("id", orgId).single(),
    supabase.from("teams").select("id, org_id, name, sport, season, created_at").eq("org_id", orgId),
    supabase.rpc("get_org_members", { p_org_id: orgId }),
    supabase.from("team_members").select("id, team_id, user_id, role, joined_at").eq("user_id", uid),
    opts?.myOrgs ? Promise.resolve(opts.myOrgs) : getMyOrgs(),
  ]);

  if (profileRes.error || !profileRes.data) throw new Error(`Failed to load profile: ${profileRes.error?.message}`);
  const baseProfile = rowToProfile(profileRes.data as ProfileRow);
  const org = orgRes.data ? rowToOrg(orgRes.data as OrgRow) : null;
  const allOrgTeams = teamsRes.data ? (teamsRes.data as TeamRow[]).map(rowToTeam) : [];
  const orgMembers = membersRes.data ? (membersRes.data as OrgMemberRow[]).map(rowToOrgMember) : [];

  const myMembership = orgMembers.find((m) => m.id === uid);
  const profile: UserProfile = { ...baseProfile, role: (myMembership?.role ?? baseProfile.role) as UserProfile["role"] };

  const memberTeamIds = new Set(membershipsRes.error ? [] : (membershipsRes.data ?? []).map((m: TeamMemberRow) => m.team_id));
  const myTeams = allOrgTeams.filter((t) => memberTeamIds.has(t.id));

  return { profile, org, myTeams, allOrgTeams, orgMembers, myOrgs, secondaryOrgs: myOrgs };
}

// ---------------------------------------------------------------------------
// Org / Team creation (via SECURITY DEFINER RPCs)
// ---------------------------------------------------------------------------

export async function createOrg(name: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_org_for_user", { org_name: name });
  if (error) {
    if (error.message.includes("already_in_org")) throw new Error("You already belong to an organization.");
    throw new Error(`Failed to create organization: ${error.message}`);
  }
  return data as string;
}

export async function createTeam(name: string, season?: string, orgId?: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_team_for_org", {
    team_name: name,
    team_season: season ?? null,
    p_org_id: orgId ?? null,
  });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can create teams.");
    throw new Error(`Failed to create team: ${error.message}`);
  }
  return data as string;
}

// ---------------------------------------------------------------------------
// Invite codes
// ---------------------------------------------------------------------------

export async function generateInviteCode(
  teamId: string,
  role: 'coach' | 'player',
  maxUses?: number
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("generate_team_invite", {
    p_team_id: teamId,
    p_role: role,
    p_max_uses: maxUses ?? null,
    p_expires_in_hours: null,
  });
  if (error) throw new Error(`Failed to generate invite: ${error.message}`);
  return data as string;
}

export async function listInvitesForTeam(teamId: string): Promise<TeamInvite[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("team_invites")
    .select("id, team_id, code, role, created_by, created_at, expires_at, used_count, max_uses")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list invites: ${error.message}`);
  return (data ?? []).map((r) => rowToInvite(r as TeamInviteRow));
}

export async function deleteInvite(inviteId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("team_invites").delete().eq("id", inviteId);
  if (error) throw new Error(`Failed to delete invite: ${error.message}`);
}

export async function joinTeamByCode(code: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("join_team_by_code", { invite_code: code.toUpperCase() });
  if (error) {
    if (error.message.includes("invalid_code")) throw new Error("Invalid invite code.");
    if (error.message.includes("code_expired")) throw new Error("This invite code has expired.");
    if (error.message.includes("code_exhausted")) throw new Error("This invite code has reached its maximum uses.");
    throw new Error(`Failed to join team: ${error.message}`);
  }
  return data as string;
}

// ---------------------------------------------------------------------------
// Get all user IDs that are members of the given teams
// ---------------------------------------------------------------------------

export async function getTeamMemberIds(teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("user_id")
    .in("team_id", teamIds);
  if (error) return [];
  return (data ?? []).map((r: { user_id: string }) => r.user_id);
}

// ---------------------------------------------------------------------------
// Team member count helper (used in profile page roster display)
// ---------------------------------------------------------------------------

export async function getTeamMemberCounts(orgId: string): Promise<Record<string, number>> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_team_member_counts", { org_id: orgId });
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { team_id: string; member_count: number }[]) {
    counts[row.team_id] = row.member_count;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Org invites
// ---------------------------------------------------------------------------

export async function generateOrgInviteCode(
  orgId: string,
  role: 'coach' | 'player',
  maxUses?: number
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("generate_org_invite", {
    p_org_id: orgId,
    p_role: role,
    p_max_uses: maxUses ?? null,
    p_expires_in_hours: null,
  });
  if (error) throw new Error(`Failed to generate org invite: ${error.message}`);
  return data as string;
}

export async function listOrgInvites(orgId: string): Promise<OrgInvite[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("org_invites")
    .select("id, org_id, code, role, created_by, created_at, expires_at, used_count, max_uses, is_national_team, team_id, email")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list org invites: ${error.message}`);
  return (data ?? []).map((r) => rowToOrgInvite(r as OrgInviteRow));
}

export async function deleteOrgInvite(inviteId: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("org_invites")
    .delete()
    .eq("id", inviteId)
    .select("id");
  if (error) throw new Error(`Failed to delete org invite: ${error.message}`);
  if (!data || data.length === 0) throw new Error("Not authorized to delete this invite.");
}

export async function joinOrgByCode(code: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("join_org_by_code", { invite_code: code.toUpperCase() });
  if (error) {
    if (error.message.includes("invalid_code")) throw new Error("Invalid invite code.");
    if (error.message.includes("code_expired")) throw new Error("This invite code has expired.");
    if (error.message.includes("code_exhausted")) throw new Error("This invite code has reached its maximum uses.");
    if (error.message.includes("already_in_different_org")) throw new Error("You are already in a different organization.");
    throw new Error(`Failed to join organization: ${error.message}`);
  }
  return data as string;
}


export async function assignMemberToTeam(
  userId: string,
  teamId: string,
  role: 'coach' | 'player'
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("assign_member_to_team", {
    p_user_id: userId,
    p_team_id: teamId,
    p_role: role,
  });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only admins can assign members to teams.");
    if (error.message.includes("user_or_team_not_in_org")) throw new Error("User or team is not in your organization.");
    throw new Error(`Failed to assign member: ${error.message}`);
  }
}

export async function joinOrgTeam(teamId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("join_org_team", { p_team_id: teamId });
  if (error) {
    if (error.message.includes("not_in_org")) throw new Error("You are not in an organization.");
    if (error.message.includes("team_not_in_org")) throw new Error("That team is not in your organization.");
    throw new Error(`Failed to join team: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Platform admin functions
// ---------------------------------------------------------------------------

export async function createOrgForPlatform(name: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_org_for_platform", { org_name: name });
  if (error) {
    if (error.message.includes("not_platform_admin")) throw new Error("Not authorized as platform admin.");
    throw new Error(`Failed to create organization: ${error.message}`);
  }
  return data as string;
}

export async function generateAdminOrgInviteCode(orgId: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("generate_org_invite", {
    p_org_id: orgId,
    p_role: "admin",
    p_max_uses: 1,
    p_expires_in_hours: null,
  });
  if (error) throw new Error(`Failed to generate admin invite: ${error.message}`);
  return data as string;
}

interface OrgWithCountRow {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  member_count: number;
  team_count: number;
  plan_tier: string;
  plan_tier_locked_at: string | null;
  is_personal: boolean;
  owner_email: string | null;
}

export async function joinByCode(code: string): Promise<{ type: 'org' | 'team' | 'secondary_org'; orgId: string; teamId?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("join_by_code", { p_code: code.toUpperCase() });
  if (error) {
    if (error.message.includes("invalid_code")) throw new Error("Invalid invite code.");
    if (error.message.includes("code_expired")) throw new Error("This invite code has expired.");
    if (error.message.includes("code_exhausted")) throw new Error("This invite code has reached its maximum uses.");
    if (error.message.includes("already_in_different_org")) throw new Error("You are already in a different organization.");
    if (error.message.includes("license_expired"))
      throw new Error("This organization's license has expired. The organization can request a renewal from Scoutable.");
    if (error.message.includes("coach_seat_limit_reached")) throw new Error("This organization has reached its coach seat limit. Contact your organization admin.");
    if (error.message.includes("player_seat_limit_reached")) throw new Error("This organization has reached its player seat limit. Contact your organization admin.");
    throw new Error(`Failed to join: ${error.message}`);
  }
  const result = data as { type: string; org_id: string; team_id?: string };
  return { type: result.type as 'org' | 'team' | 'secondary_org', orgId: result.org_id, teamId: result.team_id };
}

export async function getInvitePreview(code: string): Promise<{
  valid: boolean;
  reason?: InviteInvalidReason;
  orgName?: string;
  teamName?: string | null;
  role?: string;
  email?: string | null;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_invite_preview", { p_code: code.toUpperCase() });
  if (error) throw new Error(`Failed to preview invite: ${error.message}`);
  const r = data as {
    valid: boolean;
    reason?: string;
    org_name?: string;
    team_name?: string | null;
    role?: string;
    email?: string | null;
  };
  return {
    valid: r.valid,
    reason: r.reason as InviteInvalidReason | undefined,
    orgName: r.org_name,
    teamName: r.team_name,
    role: r.role,
    email: r.email ?? null,
  };
}

export async function updateOrgLicense(
  orgId: string,
  coachSeats: number | null,
  playerSeats: number | null,
  expiresAt: string | null
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_org_license", {
    p_org_id: orgId,
    p_coach_seats: coachSeats,
    p_player_seats: playerSeats,
    p_expires_at: expiresAt,
  });
  if (error) {
    if (error.message.includes("not_platform_admin")) throw new Error("Not authorized as platform admin.");
    throw new Error(`Failed to update license: ${error.message}`);
  }
}

export async function requestLicenseRenewal(orgId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("request_license_renewal", { p_org_id: orgId });
  if (error) {
    if (error.message.includes("renewal_already_requested"))
      throw new Error("renewal_already_requested");
    if (error.message.includes("not_admin")) throw new Error("Only org admins can request a renewal.");
    throw new Error(`Failed to request renewal: ${error.message}`);
  }
}

export async function removeTeamMember(userId: string, teamId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("remove_member_from_team", {
    p_user_id: userId,
    p_team_id: teamId,
  });
  if (error) {
    if (error.message.includes("not_authorized")) throw new Error("Not authorized to remove team members.");
    throw new Error(`Failed to remove member: ${error.message}`);
  }
}

export async function deleteTeam(teamId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("delete_team", { p_team_id: teamId });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can delete teams.");
    throw new Error(`Failed to delete team: ${error.message}`);
  }
}

export async function removeOrgMember(userId: string, orgId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("remove_member_from_org", { p_user_id: userId, p_org_id: orgId });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can remove members.");
    if (error.message.includes("user_not_in_org")) throw new Error("User is not in your organization.");
    throw new Error(`Failed to remove member: ${error.message}`);
  }
}

export async function promoteToAdmin(userId: string, orgId?: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("promote_to_admin", { p_user_id: userId, p_org_id: orgId ?? null });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can promote members.");
    if (error.message.includes("user_not_in_org")) throw new Error("User is not in your organization.");
    throw new Error(`Failed to promote: ${error.message}`);
  }
}

export async function getAllOrgsWithCounts(): Promise<OrgWithCount[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_all_orgs_with_counts");
  if (error) {
    if (error.message.includes("not_platform_admin")) throw new Error("Not authorized as platform admin.");
    throw new Error(`Failed to load orgs: ${error.message}`);
  }
  return (data ?? []).map((r: OrgWithCountRow) => ({
    id: r.id,
    name: r.name,
    logoUrl: r.logo_url,
    createdAt: r.created_at,
    memberCount: Number(r.member_count),
    teamCount: Number(r.team_count),
    planTier: (r.plan_tier ?? 'free') as OrgPlanTier,
    planTierLockedAt: r.plan_tier_locked_at ?? null,
    isPersonal: r.is_personal ?? false,
    ownerEmail: r.owner_email ?? null,
  }));
}


export async function sendEmailInvites(orgId: string, emails: string[], role: string, teamId?: string | null): Promise<number> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("send_org_invite_emails", {
    p_org_id: orgId,
    p_emails: emails,
    p_role: role,
    p_team_id: teamId ?? null,
  });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins and coaches can send invites.");
    if (error.message.includes("invalid_role")) throw new Error("Invalid role.");
    throw new Error(`Failed to send invites: ${error.message}`);
  }
  return data as number;
}

export async function resendEmailInvite(
  inviteId: string,
  orgId: string,
  email: string,
  role: string,
  teamId?: string | null
): Promise<void> {
  await deleteOrgInvite(inviteId);
  await sendEmailInvites(orgId, [email], role, teamId);
}

export async function getOrCreateLinkInvite(
  orgId: string,
  role: string,
  teamId?: string | null,
  expiryHours?: number | null
): Promise<OrgInvite> {
  const supabase = createClient();

  let query = supabase
    .from("org_invites")
    .select("id, org_id, code, role, created_by, created_at, expires_at, used_count, max_uses, is_national_team, team_id, email")
    .eq("org_id", orgId)
    .eq("role", role)
    .is("email", null)
    .is("max_uses", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data: existing } = await query.maybeSingle();
  if (existing) return rowToOrgInvite(existing as OrgInviteRow);

  const { data: code, error } = await supabase.rpc("generate_org_invite", {
    p_org_id: orgId,
    p_role: role,
    p_max_uses: null,
    p_expires_in_hours: expiryHours ?? null,
    p_team_id: teamId ?? null,
  });
  if (error) throw new Error(`Failed to create link invite: ${error.message}`);

  const { data: created, error: fetchErr } = await supabase
    .from("org_invites")
    .select("id, org_id, code, role, created_by, created_at, expires_at, used_count, max_uses, is_national_team, team_id, email")
    .eq("code", code as string)
    .single();
  if (fetchErr || !created) throw new Error("Failed to fetch created invite");
  return rowToOrgInvite(created as OrgInviteRow);
}

export async function updateOrgInviteExpiry(inviteId: string, expiryHours: number | null): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_org_invite_expiry", {
    p_invite_id: inviteId,
    p_expires_in_hours: expiryHours,
  });
  if (error) {
    if (error.message.includes("not_found")) throw new Error("Invite not found.");
    if (error.message.includes("not_admin")) throw new Error("Only org admins can update invite settings.");
    throw new Error(`Failed to update invite: ${error.message}`);
  }
}

export async function getSubscriptionStatus(): Promise<{
  isActive: boolean;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
}> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { isActive: false, status: null, plan: null, currentPeriodEnd: null };

  const { data } = await supabase
    .from("stripe_customers")
    .select("subscription_status, plan_name, current_period_end")
    .eq("email", user.email)
    .maybeSingle();

  const isActive = ["active", "trialing"].includes(data?.subscription_status ?? "");
  return {
    isActive,
    status: data?.subscription_status ?? null,
    plan: data?.plan_name ?? null,
    currentPeriodEnd: data?.current_period_end ?? null,
  };
}
