import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, ChevronRight, Loader2, MoreHorizontal, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { initials } from "@scoutable/shared/lib/playlist-feed";
import { teamDeleteWarning, type TeamDeleteImpact } from "@scoutable/shared/lib/team-delete";
import { AddMembersToTeamModal } from "@/components/add-members-to-team-modal";
import { CreateTeamDialog } from "@/components/create-team-dialog";
import { EmptyState } from "@/components/empty-state";
import { InviteModal } from "@/components/invite-modal";
import { OrgLicenseCard } from "@/components/org-license-card";
import { PendingInvites } from "@/components/pending-invites";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useAuth } from "@/lib/auth-context";
import { springs } from "@/lib/motion";
import {
  getOrgContext,
  getOrgContextForOrg,
  getTeamMemberCounts,
  joinOrgTeam,
  promoteToAdmin,
  removeOrgMember,
  removeTeamMember,
  deleteTeam,
  getTeamDeleteImpact,
} from "@/lib/profile-db";
import { roleLabel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { OrgContext, OrgTeam, UserProfile } from "@/types/org";

type View = "teams" | "members";
type RoleFilter = "all" | "admin" | "coach" | "player";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Avatar({ name, url, className }: { name: string; url?: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-caption font-semibold text-primary",
        className,
      )}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function MemberRow({
  member,
  showEmail,
  canAct,
  busy,
  onPromote,
  onRemove,
}: {
  member: UserProfile;
  showEmail: boolean;
  canAct: boolean;
  busy: boolean;
  onPromote: () => void;
  onRemove: () => void;
}) {
  const name = member.fullName ?? member.email ?? member.id.slice(0, 8);
  return (
    <div className="flex min-h-12 items-center gap-3 px-4 py-2">
      <Avatar name={name} url={member.avatarUrl} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{name}</span>
        {showEmail && member.fullName && member.email && (
          <span className="truncate text-callout text-muted-foreground">{member.email}</span>
        )}
      </div>
      {member.isPlatformAdmin ? (
        <Badge variant="destructive">{roleLabel(member.role, true)}</Badge>
      ) : (
        <span className="shrink-0 text-callout text-muted-foreground">{roleLabel(member.role)}</span>
      )}
      {canAct &&
        (busy ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {member.role === "coach" && (
                <>
                  <DropdownMenuItem onSelect={onPromote}>Make admin</DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-white" onSelect={onRemove}>
                Remove from club…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** A team's members, loaded when its row opens. */
function TeamMembers({
  team,
  orgMembers,
  isAdmin,
  canManage,
  inviteDisabled,
  onChanged,
  onInvite,
  onAddMembers,
}: {
  team: OrgTeam;
  orgMembers: UserProfile[];
  isAdmin: boolean;
  canManage: boolean;
  inviteDisabled?: boolean;
  onChanged: () => void;
  onInvite: () => void;
  onAddMembers: (currentIds: Set<string>) => void;
}) {
  const [members, setMembers] = useState<{ userId: string; role: string }[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function load() {
    const { data } = await createClient().from("team_members").select("user_id, role").eq("team_id", team.id);
    setMembers((data ?? []).map((r: { user_id: string; role: string }) => ({ userId: r.user_id, role: r.role })));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id]);

  async function handleRemove(userId: string) {
    setRemovingId(userId);
    try {
      await removeTeamMember(userId, team.id);
      toast.success("Removed from the team");
      onChanged();
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="border-t border-separator bg-fill-1/50">
      {members === null ? (
        [0, 1].map((i) => (
          <div key={i} className="flex min-h-11 items-center gap-3 py-2 pr-4 pl-12" aria-hidden>
            <span className="size-6 rounded-full bg-fill-2" />
            <span className="h-3 w-40 rounded bg-fill-2" />
          </div>
        ))
      ) : members.length === 0 ? (
        <p className="py-3 pr-4 pl-12 text-callout text-muted-foreground">No one is on this team yet.</p>
      ) : (
        members.map((tm) => {
          const profile = orgMembers.find((m) => m.id === tm.userId);
          const name = profile?.fullName ?? profile?.email ?? tm.userId.slice(0, 8);
          return (
            <div key={tm.userId} className="flex min-h-11 items-center gap-3 py-1.5 pr-4 pl-12">
              <Avatar name={name} url={profile?.avatarUrl} className="size-6" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{name}</span>
                {canManage && profile?.fullName && profile.email && (
                  <span className="truncate text-callout text-muted-foreground">{profile.email}</span>
                )}
              </div>
              <span className="shrink-0 text-callout text-muted-foreground">{roleLabel(tm.role)}</span>
              {isAdmin &&
                (removingId === tm.userId ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive focus:text-white"
                        onSelect={() => void handleRemove(tm.userId)}
                      >
                        Remove from team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
            </div>
          );
        })
      )}
      {canManage && (
        <div className="flex items-center gap-2 border-t border-separator py-2 pr-4 pl-12">
          <Button size="xs" variant="ghost" className="text-primary" onClick={onInvite} disabled={inviteDisabled}>
            <UserPlus />
            Invite to team…
          </Button>
          {isAdmin && members && (
            <Button
              size="xs"
              variant="ghost"
              className="text-primary"
              onClick={() => onAddMembers(new Set(members.map((m) => m.userId)))}
            >
              <Users />
              Add members…
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function TeamRow({
  team,
  memberCount,
  myRole,
  expanded,
  onToggle,
  isAdmin,
  onDelete,
  children,
}: {
  team: OrgTeam;
  memberCount: number;
  myRole: string;
  expanded: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex min-h-12 items-center gap-2 py-2 pr-3 pl-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${team.name}'s members` : `Show ${team.name}'s members`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <ChevronRight className={cn("size-4 transition-transform duration-200 ease-spring", expanded && "rotate-90")} />
        </button>
        {/* A pointer target only: the chevron is the keyboard control. */}
        <div onClick={onToggle} className="flex min-w-0 flex-1 flex-col pl-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{team.name}</span>
            {team.season && <Badge variant="outline">{team.season}</Badge>}
          </span>
          <span className="truncate text-callout text-muted-foreground nums">
            {plural(memberCount, "member")} · You're {myRole === "admin" ? "an admin" : `a ${roleLabel(myRole).toLowerCase()}`}
          </span>
        </div>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${team.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-white" onSelect={onDelete}>
                Delete team…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="members"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={springs.standard}
            className="overflow-hidden"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function OrganizationPage() {
  const { user, activeOrgId, activeOrgCanManage, profileLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Staff only: players see their club and teams read-only in Profile.
  const canAccess = activeOrgCanManage;

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});
  const [myTeamRoles, setMyTeamRoles] = useState<Record<string, string>>({});
  const [view, setView] = useState<View>("teams");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [joiningTeamId, setJoiningTeamId] = useState<string | null>(null);
  const [deleteTeamTarget, setDeleteTeamTarget] = useState<OrgTeam | null>(null);
  /** Keyed by team so a slow response can't describe a different team. */
  const [deleteImpact, setDeleteImpact] = useState<{ teamId: string; impact: TeamDeleteImpact } | null>(null);
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<UserProfile | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  /** The invite dialog, and the team it was opened for (undefined: the club). */
  const [invite, setInvite] = useState<{ teamId?: string; role?: "coach" | "player" } | null>(null);
  const [addMembers, setAddMembers] = useState<{ team: OrgTeam; currentIds: Set<string> } | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");

  // One-shot flags from Home and the admin setup checklist: { invite,
  // inviteRole? } opens the invite dialog, { newTeam } the new-team dialog.
  // Cleared at once so a remount doesn't reopen them.
  useEffect(() => {
    const state = location.state as { invite?: boolean; inviteRole?: "coach" | "player"; newTeam?: boolean } | null;
    if (state?.invite || state?.newTeam) {
      if (state.newTeam) setShowCreateTeam(true);
      else setInvite({ role: state.inviteRole });
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  async function load(orgId?: string) {
    try {
      const context = orgId ? await getOrgContextForOrg(orgId) : await getOrgContext();
      setCtx(context);
      if (context.org && context.allOrgTeams.length > 0) {
        setMemberCounts(await getTeamMemberCounts(context.org.id));
      }
      if (user && context.myTeams.length > 0) {
        const { data } = await createClient().from("team_members").select("team_id, role").eq("user_id", user.id);
        const roles: Record<string, string> = {};
        for (const row of (data ?? []) as { team_id: string; role: string }[]) roles[row.team_id] = row.role;
        setMyTeamRoles(roles);
      }
    } catch {
      toast.error("Couldn't load the club");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (canAccess) void load(activeOrgId ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, canAccess]);

  const reload = () => void load(activeOrgId ?? undefined);

  /**
   * Deleting a team is irreversible and cascades to playlist_shares, so it
   * always asks. The counts in the question load while the dialog is open;
   * confirming waits for them, because the point is an informed decision.
   */
  function requestDeleteTeam(team: OrgTeam) {
    setDeleteTeamTarget(team);
    setDeleteImpact(null);
    getTeamDeleteImpact(team.id)
      .then((impact) => setDeleteImpact({ teamId: team.id, impact }))
      .catch((e) => {
        setDeleteTeamTarget(null);
        toast.error((e as Error).message);
      });
  }

  async function confirmDeleteTeam() {
    const team = deleteTeamTarget;
    if (!team) return;
    setDeletingTeam(true);
    try {
      await deleteTeam(team.id);
      toast.success("Team deleted");
      setDeleteTeamTarget(null);
      await load(activeOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeletingTeam(false);
    }
  }

  async function handleJoinTeam(teamId: string) {
    setJoiningTeamId(teamId);
    try {
      await joinOrgTeam(teamId);
      toast.success("You joined the team");
      await load(activeOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setJoiningTeamId(null);
    }
  }

  async function handlePromote(userId: string) {
    const orgId = ctx?.org?.id;
    if (!orgId) return;
    try {
      await promoteToAdmin(userId, orgId);
      toast.success("Now an admin");
      await load(activeOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function confirmRemoveMember() {
    const member = removeTarget;
    const orgId = ctx?.org?.id;
    if (!member || !orgId) return;
    setRemovingMemberId(member.id);
    try {
      await removeOrgMember(member.id, orgId);
      toast.success(`${member.fullName ?? member.email ?? "Member"} removed from the club`);
      setRemoveTarget(null);
      await load(activeOrgId ?? undefined);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemovingMemberId(null);
    }
  }

  const filteredMembers = useMemo(() => {
    if (!ctx) return [];
    const q = memberSearch.trim().toLowerCase();
    return ctx.orgMembers
      .filter((m) => roleFilter === "all" || m.role === roleFilter)
      .filter((m) => !q || m.fullName?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q));
  }, [ctx, memberSearch, roleFilter]);

  if (!profileLoading && !canAccess) return null;

  if (loading || !ctx || ctx.org === null) {
    return (
      <Page>
        <Toolbar title="Club" />
        <PageContent width="medium">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : !ctx ? (
            <EmptyState
              icon={<Building2 />}
              title="Couldn't load the club"
              body="Check your connection and try again."
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setLoading(true);
                    void load(activeOrgId ?? undefined);
                  }}
                >
                  Try again
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Building2 />}
              title="No club yet"
              body={
                ctx.profile.isPlatformAdmin
                  ? "You don't belong to a club. Clubs are managed in the web app, at app.scoutable.se/admin."
                  : "You don't belong to a club yet."
              }
            />
          )}
        </PageContent>
      </Page>
    );
  }

  const profile = ctx.profile;
  const isAdmin = profile.role === "admin";
  const canManageTeams = profile.role === "admin" || profile.role === "coach";
  const org = ctx.org;
  const myTeams = ctx.myTeams.filter((t) => t.orgId === org.id);
  const myTeamIds = new Set(myTeams.map((t) => t.id));
  const otherTeams = ctx.allOrgTeams.filter((t) => !myTeamIds.has(t.id));
  const licenseExpired = !!org.expiresAt && new Date(org.expiresAt).getTime() < Date.now();
  const roleCount = (r: RoleFilter) => (r === "all" ? ctx.orgMembers.length : ctx.orgMembers.filter((m) => m.role === r).length);

  return (
    <Page>
      <Toolbar
        title={org.name}
        subtitle={`${plural(ctx.orgMembers.length, "member")} · ${plural(ctx.allOrgTeams.length, "team")}`}
        principal={
          canManageTeams ? (
            <SegmentedControl
              aria-label="Show"
              value={view}
              onValueChange={setView}
              options={[
                { value: "teams", label: "Teams" },
                { value: "members", label: "Members" },
              ]}
            />
          ) : undefined
        }
        search={
          view === "members" ? (
            <SearchField
              placeholder="Search members"
              aria-label="Search members"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
          ) : undefined
        }
        actions={
          canManageTeams && (
            <Button size="sm" onClick={() => setInvite({})} disabled={licenseExpired}>
              <UserPlus />
              Invite people
            </Button>
          )
        }
      />
      <PageContent width="medium" className="space-y-7">
        {isAdmin && (
          <OrgLicenseCard
            orgId={org.id}
            coachSeatLimit={org.coachSeatLimit}
            playerSeatLimit={org.playerSeatLimit}
            expiresAt={org.expiresAt}
            coachCount={ctx.orgMembers.filter((m) => m.role !== "player").length}
            playerCount={ctx.orgMembers.filter((m) => m.role === "player").length}
          />
        )}

        {view === "teams" ? (
          <>
            <section>
              <GroupHeader
                title="Your teams"
                action={
                  isAdmin && (
                    <Button size="xs" variant="ghost" className="text-primary" onClick={() => setShowCreateTeam(true)}>
                      New team…
                    </Button>
                  )
                }
              />
              {myTeams.length === 0 ? (
                <GroupedList>
                  <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
                    <span className="text-callout text-muted-foreground">
                      {isAdmin && ctx.allOrgTeams.length === 0
                        ? "No teams yet. Invites can name a team, so new members land in the right place."
                        : canManageTeams
                          ? ctx.allOrgTeams.length === 0
                            ? "No teams yet. Your admin can create one."
                            : "You're not on a team yet."
                          : "You're not on a team yet. Ask your coach to add you."}
                    </span>
                    {isAdmin && ctx.allOrgTeams.length === 0 && (
                      <Button size="sm" onClick={() => setShowCreateTeam(true)}>
                        New team
                      </Button>
                    )}
                  </div>
                </GroupedList>
              ) : (
                <GroupedList>
                  {myTeams.map((team) => (
                    <TeamRow
                      key={team.id}
                      team={team}
                      memberCount={memberCounts[team.id] ?? 0}
                      myRole={myTeamRoles[team.id] ?? profile.role}
                      expanded={expandedTeamId === team.id}
                      onToggle={() => setExpandedTeamId((id) => (id === team.id ? null : team.id))}
                      isAdmin={isAdmin}
                      onDelete={() => requestDeleteTeam(team)}
                    >
                      <TeamMembers
                        team={team}
                        orgMembers={ctx.orgMembers}
                        isAdmin={isAdmin}
                        canManage={canManageTeams}
                        inviteDisabled={licenseExpired}
                        onChanged={reload}
                        onInvite={() => setInvite({ teamId: team.id })}
                        onAddMembers={(currentIds) => setAddMembers({ team, currentIds })}
                      />
                    </TeamRow>
                  ))}
                </GroupedList>
              )}
            </section>

            {canManageTeams && otherTeams.length > 0 && (
              <section>
                <GroupHeader title="Other teams in the club" />
                <GroupedList>
                  {otherTeams.map((team) => (
                    <div key={team.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                      <Users className="size-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm">{team.name}</span>
                          {team.season && <Badge variant="outline">{team.season}</Badge>}
                        </span>
                        <span className="text-callout text-muted-foreground nums">{plural(memberCounts[team.id] ?? 0, "member")}</span>
                      </div>
                      <Button size="xs" variant="outline" disabled={joiningTeamId === team.id} onClick={() => void handleJoinTeam(team.id)}>
                        {joiningTeamId === team.id && <Loader2 className="animate-spin" />}
                        Join
                      </Button>
                    </div>
                  ))}
                </GroupedList>
              </section>
            )}
          </>
        ) : (
          <>
            <SegmentedControl
              aria-label="Role"
              value={roleFilter}
              onValueChange={setRoleFilter}
              options={(["all", "admin", "coach", "player"] as const).map((r) => ({
                value: r,
                label: (
                  <>
                    {r === "all" ? "Everyone" : r === "admin" ? "Admins" : r === "coach" ? "Coaches" : "Players"}{" "}
                    <span className="opacity-60 nums">{roleCount(r)}</span>
                  </>
                ),
              }))}
            />
            {ctx.orgMembers.length === 0 ? (
              <EmptyState icon={<Users />} title="No members yet" body="Invite coaches and players to the club." />
            ) : filteredMembers.length === 0 ? (
              <EmptyState title="No one found" body="No members match your search." />
            ) : (
              (["admin", "coach", "player"] as const).map((role) => {
                const group = filteredMembers.filter((m) => m.role === role);
                if (group.length === 0) return null;
                const label = role === "admin" ? "Admins" : role === "coach" ? "Coaches" : "Players";
                return (
                  <section key={role}>
                    <GroupHeader
                      title={
                        <>
                          {label} <span className="font-normal text-muted-foreground nums">{group.length}</span>
                        </>
                      }
                    />
                    <GroupedList>
                      {group.map((m) => (
                        <MemberRow
                          key={m.id}
                          member={m}
                          showEmail={canManageTeams}
                          canAct={isAdmin && m.id !== profile.id && !m.isPlatformAdmin}
                          busy={removingMemberId === m.id}
                          onPromote={() => void handlePromote(m.id)}
                          onRemove={() => setRemoveTarget(m)}
                        />
                      ))}
                    </GroupedList>
                  </section>
                );
              })
            )}
            <PendingInvites orgId={org.id} orgTeams={ctx.allOrgTeams} isAdmin={isAdmin} />
          </>
        )}

        {profile.isPlatformAdmin && (
          <GroupFooter>Clubs are managed in the web app, at app.scoutable.se/admin.</GroupFooter>
        )}
      </PageContent>

      <InviteModal
        open={invite !== null}
        onClose={() => setInvite(null)}
        initialRole={invite?.role}
        initialTeamId={invite?.teamId}
        orgId={org.id}
        orgName={org.name}
        orgTeams={ctx.allOrgTeams}
        orgMembers={ctx.orgMembers}
        isAdmin={isAdmin}
        licenseExpired={licenseExpired}
        coachSeatLimit={org.coachSeatLimit}
        playerSeatLimit={org.playerSeatLimit}
      />

      {addMembers && (
        <AddMembersToTeamModal
          open
          onClose={() => setAddMembers(null)}
          team={addMembers.team}
          orgMembers={ctx.orgMembers}
          currentTeamMemberIds={addMembers.currentIds}
          onAdded={() => {
            reload();
            // Reopen the team so its member list reloads with the new faces.
            const id = addMembers.team.id;
            setExpandedTeamId(null);
            requestAnimationFrame(() => setExpandedTeamId(id));
          }}
        />
      )}

      <CreateTeamDialog open={showCreateTeam} onClose={() => setShowCreateTeam(false)} onCreated={reload} orgId={activeOrgId ?? undefined} />

      {/* Removing someone takes away their access to everything shared with the club. */}
      <Dialog open={!!removeTarget} onOpenChange={(o) => !o && !removingMemberId && setRemoveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {removeTarget?.fullName ?? removeTarget?.email} from {org.name}?</DialogTitle>
            <DialogDescription>
              They lose access to the club's teams and shared playlists. You can invite them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={!!removingMemberId} onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!!removingMemberId} onClick={() => void confirmRemoveMember()}>
              {removingMemberId && <Loader2 className="animate-spin" />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Team deletion is irreversible and unshares the team's playlists. */}
      <Dialog open={!!deleteTeamTarget} onOpenChange={(o) => !o && !deletingTeam && setDeleteTeamTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleteTeamTarget?.name}”?</DialogTitle>
            <DialogDescription>
              {deleteTeamTarget && deleteImpact?.teamId === deleteTeamTarget.id
                ? teamDeleteWarning(deleteImpact.impact)
                : "Checking what this affects…"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={deletingTeam} onClick={() => setDeleteTeamTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deletingTeam || !deleteTeamTarget || deleteImpact?.teamId !== deleteTeamTarget.id}
              onClick={() => void confirmDeleteTeam()}
            >
              {deletingTeam && <Loader2 className="animate-spin" />}
              Delete team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
