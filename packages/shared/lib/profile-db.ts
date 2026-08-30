/**
 * Shared read-side profile/org operations.
 *
 * Reader subset of the per-app profile-db modules (apps/web, apps/desktop),
 * hoisted for mobile. Unlike those copies, every function here takes a
 * SupabaseClient as its first argument — desktop, web, and mobile pass their
 * own platform-specific client. Write/admin/invite-management functions stay
 * app-local for now.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UserProfile,
  Organization,
  OrgTeam,
  OrgContext,
  OrgMembership,
  OrgPlanTier,
  InviteInvalidReason,
} from "../types/org";

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

function rowToProfile(r: ProfileRow): UserProfile {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email ?? null,
    avatarUrl: r.avatar_url,
    role: r.role as UserProfile["role"],
    orgId: r.org_id,
    createdAt: r.created_at,
    isPlatformAdmin: r.is_platform_admin ?? false,
    celebratedPlanTier: (r.celebrated_plan_tier as "rookie" | "pro" | null | undefined) ?? null,
    onboardingChecklistDismissedAt: r.onboarding_checklist_dismissed_at ?? null,
    welcomeDismissedAt: r.welcome_dismissed_at ?? null,
    declaredRole: (r.declared_role as "coach" | "player" | null | undefined) ?? null,
  };
}

function rowToOrgMember(r: OrgMemberRow): UserProfile {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    avatarUrl: r.avatar_url,
    role: r.role as UserProfile["role"],
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
    planTier: (r.plan_tier ?? "free") as OrgPlanTier,
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

export async function getMyProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, avatar_url, role, org_id, created_at, is_platform_admin, celebrated_plan_tier, onboarding_checklist_dismissed_at, welcome_dismissed_at, declared_role"
    )
    .eq("id", userId)
    .single();
  if (error || !data) throw new Error(`Failed to load profile: ${error?.message}`);
  return rowToProfile(data as ProfileRow);
}

export async function getMyOrgs(supabase: SupabaseClient): Promise<OrgMembership[]> {
  const { data } = await supabase.rpc("get_my_orgs");
  return (data ?? []).map(
    (r: { org_id: string; org_name: string; role: string; is_nt_org: boolean; plan_tier: string; is_personal: boolean; expires_at?: string | null }) => ({
      orgId: r.org_id,
      orgName: r.org_name,
      role: r.role as OrgMembership["role"],
      isNtOrg: r.is_nt_org,
      planTier: (r.plan_tier ?? "free") as OrgPlanTier,
      isPersonal: r.is_personal ?? false,
      expiresAt: r.expires_at ?? null,
    })
  );
}

export async function getOrgContextForOrg(supabase: SupabaseClient, orgId: string): Promise<OrgContext> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const [profileRes, orgRes, teamsRes, membersRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, avatar_url, role, org_id, created_at, is_platform_admin")
      .eq("id", user.id)
      .single(),
    supabase
      .from("organizations")
      .select("id, name, logo_url, created_at, coach_seat_limit, player_seat_limit, expires_at, is_nt_org, plan_tier")
      .eq("id", orgId)
      .single(),
    supabase.from("teams").select("id, org_id, name, sport, season, created_at").eq("org_id", orgId),
    supabase.rpc("get_org_members", { p_org_id: orgId }),
  ]);

  if (profileRes.error || !profileRes.data)
    throw new Error(`Failed to load profile: ${profileRes.error?.message}`);
  const baseProfile = rowToProfile(profileRes.data as ProfileRow);

  const org = orgRes.data ? rowToOrg(orgRes.data as OrgRow) : null;
  const allOrgTeams = teamsRes.data ? (teamsRes.data as TeamRow[]).map(rowToTeam) : [];
  const orgMembers = membersRes.data ? (membersRes.data as OrgMemberRow[]).map(rowToOrgMember) : [];

  // Use the user's role in this specific org (profiles.role may be stale)
  const myMembership = orgMembers.find((m) => m.id === user.id);
  const profile: UserProfile = {
    ...baseProfile,
    role: (myMembership?.role ?? baseProfile.role) as UserProfile["role"],
  };

  const membershipsRes = await supabase
    .from("team_members")
    .select("id, team_id, user_id, role, joined_at")
    .eq("user_id", user.id);
  const memberTeamIds = new Set(
    membershipsRes.error ? [] : (membershipsRes.data ?? []).map((m: TeamMemberRow) => m.team_id)
  );
  const myTeams = allOrgTeams.filter((t) => memberTeamIds.has(t.id));

  const myOrgs = await getMyOrgs(supabase);

  return { profile, org, myTeams, allOrgTeams, orgMembers, myOrgs, secondaryOrgs: myOrgs };
}

export async function joinByCode(
  supabase: SupabaseClient,
  code: string
): Promise<{ type: "org" | "team" | "secondary_org"; orgId: string; teamId?: string }> {
  const { data, error } = await supabase.rpc("join_by_code", { p_code: code.toUpperCase() });
  if (error) {
    if (error.message.includes("invalid_code")) throw new Error("Invalid invite code.");
    if (error.message.includes("code_expired")) throw new Error("This invite code has expired.");
    if (error.message.includes("code_exhausted")) throw new Error("This invite code has reached its maximum uses.");
    if (error.message.includes("already_in_different_org")) throw new Error("You are already in a different organization.");
    if (error.message.includes("license_expired"))
      throw new Error("This organization's license has expired. The organization can request a renewal from Scoutable.");
    if (error.message.includes("coach_seat_limit_reached"))
      throw new Error("This organization has reached its coach seat limit. Contact your organization admin.");
    if (error.message.includes("player_seat_limit_reached"))
      throw new Error("This organization has reached its player seat limit. Contact your organization admin.");
    throw new Error(`Failed to join: ${error.message}`);
  }
  const result = data as { type: string; org_id: string; team_id?: string };
  return {
    type: result.type as "org" | "team" | "secondary_org",
    orgId: result.org_id,
    teamId: result.team_id,
  };
}

export async function getInvitePreview(
  supabase: SupabaseClient,
  code: string
): Promise<{
  valid: boolean;
  reason?: InviteInvalidReason;
  orgName?: string;
  teamName?: string | null;
  role?: string;
  email?: string | null;
}> {
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

export async function checkOnboardingNeeded(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_onboarding_needed");
  if (error) return false;
  return data === true;
}
