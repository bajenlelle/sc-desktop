/**
 * Database operations for profiles, organizations, teams, and team membership.
 * Adapted from apps/desktop/src/lib/profile-db.ts for the web app.
 */

import { createClient } from "@/lib/supabase/client";
import type {
  UserProfile,
  Organization,
  OrgTeam,
  TeamMember,
  TeamInvite,
  OrgInvite,
  OrgContext,
  OrgWithCount,
  NtMembership,
} from "@scoutable/shared/types/org";

interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  org_id: string | null;
  created_at: string;
  is_platform_admin: boolean;
  is_national_team: boolean;
  email?: string | null;
}

interface OrgRow {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  coach_seat_limit: number | null;
  player_seat_limit: number | null;
  expires_at: string | null;
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
}

interface OrgWithCountRow {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  member_count: number;
  team_count: number;
}

function rowToProfile(r: ProfileRow): UserProfile {
  return {
    id: r.id,
    fullName: r.full_name,
    email: (r as any).email ?? null,
    avatarUrl: r.avatar_url,
    role: r.role as UserProfile["role"],
    orgId: r.org_id,
    createdAt: r.created_at,
    isPlatformAdmin: r.is_platform_admin ?? false,
    isNationalTeam: r.is_national_team ?? false,
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
  };
}

function rowToTeam(r: TeamRow): OrgTeam {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    sport: r.sport,
    season: r.season,
    createdAt: r.created_at,
  };
}

function rowToMember(r: TeamMemberRow): TeamMember {
  return {
    id: r.id,
    teamId: r.team_id,
    userId: r.user_id,
    role: r.role as TeamMember["role"],
    joinedAt: r.joined_at,
  };
}

function rowToInvite(r: TeamInviteRow): TeamInvite {
  return {
    id: r.id,
    teamId: r.team_id,
    code: r.code,
    role: r.role as TeamInvite["role"],
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedCount: r.used_count,
    maxUses: r.max_uses,
  };
}

function rowToOrgInvite(r: OrgInviteRow): OrgInvite {
  return {
    id: r.id,
    orgId: r.org_id,
    code: r.code,
    role: r.role as OrgInvite["role"],
    createdBy: r.created_by,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    usedCount: r.used_count,
    maxUses: r.max_uses,
    isNationalTeam: r.is_national_team ?? false,
  };
}

export async function getMyProfile(userId: string): Promise<UserProfile> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin, is_national_team")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error(`Failed to load profile: ${error?.message}`);
  return rowToProfile(data as ProfileRow);
}

export async function updateMyProfile(patch: { fullName?: string; avatarUrl?: string }): Promise<void> {
  const supabase = createClient();
  const row: Record<string, unknown> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (Object.keys(row).length === 0) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("profiles").update(row).eq("id", user.id);
  if (error) throw new Error(`Failed to update profile: ${error.message}`);
}

export async function uploadAvatar(file: File): Promise<string> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${user.id}/avatar.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
  if (error) throw new Error(`Failed to upload avatar: ${error.message}`);
  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
  return urlData.publicUrl.split("?")[0];
}

export async function getOrgContext(): Promise<OrgContext> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const profileRes = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin, is_national_team")
    .eq("id", user.id)
    .single();
  if (profileRes.error || !profileRes.data)
    throw new Error(`Failed to load profile: ${profileRes.error?.message}`);
  const profile = rowToProfile(profileRes.data as ProfileRow);

  let org: Organization | null = null;
  let allOrgTeams: OrgTeam[] = [];
  let orgMembers: UserProfile[] = [];

  if (profile.orgId) {
    const [orgRes, teamsRes, membersRes] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, name, logo_url, created_at, coach_seat_limit, player_seat_limit, expires_at")
        .eq("id", profile.orgId)
        .single(),
      supabase
        .from("teams")
        .select("id, org_id, name, sport, season, created_at")
        .eq("org_id", profile.orgId),
      supabase.rpc("get_org_members_with_email"),
    ]);
    if (orgRes.data) org = rowToOrg(orgRes.data as OrgRow);
    if (teamsRes.data) allOrgTeams = (teamsRes.data as TeamRow[]).map(rowToTeam);
    if (membersRes.data) orgMembers = (membersRes.data as ProfileRow[]).map(rowToProfile);
  }

  const membershipsRes = await supabase
    .from("team_members")
    .select("id, team_id, user_id, role, joined_at")
    .eq("user_id", user.id);
  const memberTeamIds = new Set(
    membershipsRes.error ? [] : (membershipsRes.data ?? []).map((m: TeamMemberRow) => m.team_id)
  );
  const myTeams = allOrgTeams.filter((t) => memberTeamIds.has(t.id));

  // Fetch NT memberships
  const ntRes = await supabase.rpc("get_my_nt_memberships");
  const ntMemberships: NtMembership[] = (ntRes.data ?? []).map(
    (r: { nt_org_id: string; nt_org_name: string; role: string }) => ({
      ntOrgId: r.nt_org_id,
      ntOrgName: r.nt_org_name,
      role: r.role as 'coach' | 'admin',
    })
  );

  return { profile, org, myTeams, allOrgTeams, orgMembers, ntMemberships };
}

export async function createTeam(name: string, season?: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("create_team_for_org", {
    team_name: name,
    team_season: season ?? null,
  });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can create teams.");
    throw new Error(`Failed to create team: ${error.message}`);
  }
  return data as string;
}

export async function generateInviteCode(
  teamId: string,
  role: "coach" | "player",
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

export async function generateOrgInviteCode(
  orgId: string,
  role: "coach" | "player",
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
    .select("id, org_id, code, role, created_by, created_at, expires_at, used_count, max_uses, is_national_team")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list org invites: ${error.message}`);
  return (data ?? []).map((r) => rowToOrgInvite(r as OrgInviteRow));
}

export async function deleteOrgInvite(inviteId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("org_invites").delete().eq("id", inviteId);
  if (error) throw new Error(`Failed to delete org invite: ${error.message}`);
}

export async function assignMemberToTeam(
  userId: string,
  teamId: string,
  role: "coach" | "player"
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("assign_member_to_team", {
    p_user_id: userId,
    p_team_id: teamId,
    p_role: role,
  });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only admins can assign members to teams.");
    if (error.message.includes("user_or_team_not_in_org"))
      throw new Error("User or team is not in your organization.");
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

export async function promoteToAdmin(userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("promote_to_admin", { p_user_id: userId });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can promote members.");
    if (error.message.includes("user_not_in_org")) throw new Error("User is not in your organization.");
    throw new Error(`Failed to promote: ${error.message}`);
  }
}

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
  }));
}

export async function getOrgById(orgId: string): Promise<Organization> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, logo_url, created_at, coach_seat_limit, player_seat_limit, expires_at")
    .eq("id", orgId)
    .single();
  if (error || !data) throw new Error(`Failed to load organization: ${error?.message}`);
  return rowToOrg(data as OrgRow);
}

export async function getOrgMembersForAdmin(orgId: string): Promise<UserProfile[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin, is_national_team")
    .eq("org_id", orgId);
  if (error) throw new Error(`Failed to load org members: ${error.message}`);
  return (data ?? []).map((r) => rowToProfile(r as ProfileRow));
}

export async function joinByCode(code: string): Promise<{ type: "org" | "team" | "nt_org"; orgId: string; teamId?: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("join_by_code", { p_code: code.toUpperCase() });
  if (error) {
    if (error.message.includes("invalid_code")) throw new Error("Invalid invite code.");
    if (error.message.includes("code_expired")) throw new Error("This invite code has expired.");
    if (error.message.includes("code_exhausted")) throw new Error("This invite code has reached its maximum uses.");
    if (error.message.includes("already_in_different_org")) throw new Error("You are already in a different organization.");
    if (error.message.includes("license_expired")) throw new Error("Your organization's license has expired. Contact your admin.");
    if (error.message.includes("coach_seat_limit_reached")) throw new Error("This organization has reached its coach seat limit.");
    if (error.message.includes("player_seat_limit_reached")) throw new Error("This organization has reached its player seat limit.");
    throw new Error(`Failed to join: ${error.message}`);
  }
  const result = data as { type: string; org_id: string; team_id?: string };
  return { type: result.type as "org" | "team" | "nt_org", orgId: result.org_id, teamId: result.team_id };
}

export async function getInvitePreview(code: string): Promise<{
  valid: boolean;
  orgName?: string;
  teamName?: string | null;
  role?: string;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_invite_preview", { p_code: code.toUpperCase() });
  if (error) throw new Error(`Failed to preview invite: ${error.message}`);
  const r = data as { valid: boolean; org_name?: string; team_name?: string | null; role?: string };
  return { valid: r.valid, orgName: r.org_name, teamName: r.team_name, role: r.role };
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

export async function removeOrgMember(userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("remove_member_from_org", { p_user_id: userId });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only org admins can remove members.");
    if (error.message.includes("user_not_in_org")) throw new Error("User is not in your organization.");
    throw new Error(`Failed to remove member: ${error.message}`);
  }
}

export async function updateOrgNameForPlatform(orgId: string, name: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("update_org_name_for_platform", {
    p_org_id: orgId,
    p_name: name,
  });
  if (error) {
    if (error.message.includes("not_platform_admin")) throw new Error("Not authorized as platform admin.");
    throw new Error(`Failed to update org name: ${error.message}`);
  }
}


// ---------------------------------------------------------------------------
// NT membership management
// ---------------------------------------------------------------------------

export async function getNtOrgMembers(ntOrgId: string): Promise<{ userId: string; fullName: string | null; avatarUrl: string | null; role: string; joinedAt: string }[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_nt_org_members", { p_nt_org_id: ntOrgId });
  if (error) throw new Error(`Failed to load NT org members: ${error.message}`);
  return (data ?? []).map((r: { user_id: string; full_name: string | null; avatar_url: string | null; role: string; joined_at: string }) => ({
    userId: r.user_id,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    role: r.role,
    joinedAt: r.joined_at,
  }));
}

export async function removeNtMember(userId: string, ntOrgId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("remove_nt_member", { p_user_id: userId, p_nt_org_id: ntOrgId });
  if (error) {
    if (error.message.includes("not_admin")) throw new Error("Only NT org admins can remove members.");
    throw new Error(`Failed to remove NT member: ${error.message}`);
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
