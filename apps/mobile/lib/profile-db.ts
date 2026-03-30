/**
 * Database operations for profiles, organizations, teams, and team membership.
 * Ported from apps/web/src/lib/profile-db.ts — same logic, uses mobile supabase client.
 */

import { supabase } from "./supabase";
import type {
  UserProfile,
  Organization,
  OrgTeam,
  TeamMember,
  TeamInvite,
  OrgInvite,
  OrgContext,
} from "@scoutable/shared/types/org";

interface ProfileRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  org_id: string | null;
  created_at: string;
  is_platform_admin: boolean;
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
  };
}

export async function getMyProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin")
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error(`Failed to load profile: ${error?.message}`);
  return rowToProfile(data as ProfileRow);
}

export async function updateMyProfile(patch: { fullName?: string }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.fullName !== undefined) row.full_name = patch.fullName;
  if (Object.keys(row).length === 0) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("profiles").update(row).eq("id", user.id);
  if (error) throw new Error(`Failed to update profile: ${error.message}`);
}

export async function getOrgContext(): Promise<OrgContext> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const profileRes = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin")
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

  return { profile, org, myTeams, allOrgTeams, orgMembers };
}

export async function joinByCode(
  code: string
): Promise<{ type: "org" | "team"; orgId: string; teamId?: string }> {
  const { data, error } = await supabase.rpc("join_by_code", { p_code: code.toUpperCase() });
  if (error) {
    if (error.message.includes("invalid_code")) throw new Error("Invalid invite code.");
    if (error.message.includes("code_expired")) throw new Error("This invite code has expired.");
    if (error.message.includes("code_exhausted"))
      throw new Error("This invite code has reached its maximum uses.");
    if (error.message.includes("already_in_different_org"))
      throw new Error("You are already in a different organization.");
    if (error.message.includes("license_expired"))
      throw new Error("Your organization's license has expired. Contact your admin.");
    if (error.message.includes("coach_seat_limit_reached"))
      throw new Error("This organization has reached its coach seat limit.");
    if (error.message.includes("player_seat_limit_reached"))
      throw new Error("This organization has reached its player seat limit.");
    throw new Error(`Failed to join: ${error.message}`);
  }
  const result = data as { type: string; org_id: string; team_id?: string };
  return { type: result.type as "org" | "team", orgId: result.org_id, teamId: result.team_id };
}

export async function getInvitePreview(code: string): Promise<{
  valid: boolean;
  orgName?: string;
  teamName?: string | null;
  role?: string;
}> {
  const { data, error } = await supabase.rpc("get_invite_preview", {
    p_code: code.toUpperCase(),
  });
  if (error) throw new Error(`Failed to preview invite: ${error.message}`);
  const r = data as { valid: boolean; org_name?: string; team_name?: string | null; role?: string };
  return { valid: r.valid, orgName: r.org_name, teamName: r.team_name, role: r.role };
}
