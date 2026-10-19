"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CloudUpload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setPlaylistTeams, setPlaylistUsers } from "@scoutable/shared/lib/playlists-db";
import type { Playlist } from "@scoutable/shared/types/match";
import type { OrgTeam, UserProfile } from "@scoutable/shared/types/org";
import { useAuth } from "@/components/auth-context";
import { ShareRecipients } from "@/components/playlist/share-recipients";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Callout } from "@/components/ui/group";
import { trackEvent } from "@/lib/analytics";
import { getOrgContextForOrg } from "@/lib/profile-db";
import { createClient } from "@/lib/supabase/client";

/** What the dialog says about the playlist's clips before they are shared. */
export interface ShareReadiness {
  /** Clips without a file yet whose game has a cloud copy: the server cuts them once shared. */
  prepare: number;
  /** Clips whose game has no cloud copy: recipients will not see them. */
  noCopy: number;
  /** The playlist holds clips of the sample game, which can't be shared. */
  demo?: boolean;
}

export interface ShareDialogProps {
  /** The playlist to share; null keeps the dialog closed. */
  playlist: Playlist | null;
  /** The club space whose teams and members can be chosen (sharing needs a club space). */
  orgId: string | null;
  onClose: () => void;
  /** The shares were written; the caller updates its own copy of the playlist (and asks for the clips to be cut). */
  onShared: (playlist: Playlist, teamIds: string[], userIds: string[]) => void | Promise<void>;
  readiness?: ShareReadiness;
}

/**
 * Who can watch a playlist: the teams and members of the active club space,
 * loaded when the dialog opens. Writes the shares itself, so the Playlists
 * list, the editor and the shared-playlists page share one behaviour, then
 * hands the result to the caller.
 */
export function ShareDialog({ playlist, orgId, onClose, onShared, readiness }: ShareDialogProps) {
  const { user, myOrgs } = useAuth();
  const [teams, setTeams] = useState<OrgTeam[]>([]);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());
  const [userIds, setUserIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const open = playlist !== null;
  const playlistId = playlist?.id ?? null;

  // The recipients the playlist has today, every time it opens.
  useEffect(() => {
    if (!playlist) return;
    setTeamIds(new Set(playlist.teamIds ?? (playlist.teamId ? [playlist.teamId] : [])));
    setUserIds(new Set(playlist.userIds ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when a different playlist opens, not on every re-render of the same one
  }, [playlistId]);

  useEffect(() => {
    if (!open || !orgId) return;
    let cancelled = false;
    setLoading(true);
    getOrgContextForOrg(orgId, { myOrgs })
      .then((ctx) => {
        if (cancelled) return;
        setTeams(ctx.allOrgTeams);
        setMembers(ctx.orgMembers);
      })
      .catch(() => {
        if (!cancelled) toast.error("Couldn't load your club's teams");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId, myOrgs]);

  const others = useMemo(() => members.filter((m) => m.id !== user?.id), [members, user?.id]);
  const hasRecipients = (playlist?.teamIds?.length ?? 0) > 0 || (playlist?.userIds?.length ?? 0) > 0 || !!playlist?.teamId;

  const toggle = (set: (fn: (prev: Set<string>) => Set<string>) => void) => (id: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function save(nextTeamIds: string[], nextUserIds: string[]) {
    if (!playlist) return;
    setSaving(true);
    try {
      const supabase = createClient();
      await Promise.all([setPlaylistTeams(supabase, playlist.id, nextTeamIds), setPlaylistUsers(supabase, playlist.id, nextUserIds)]);
      trackEvent("playlist_shared", { team_count: nextTeamIds.length, user_count: nextUserIds.length, origin: "web" });
      await onShared(playlist, nextTeamIds, nextUserIds);
    } catch (e) {
      toast.error("Couldn't update sharing", { description: (e as Error).message });
      return;
    } finally {
      setSaving(false);
    }
    onClose();
  }

  const prepare = readiness?.prepare ?? 0;
  const noCopy = readiness?.noCopy ?? 0;
  const demo = readiness?.demo ?? false;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share playlist</DialogTitle>
          <DialogDescription>Choose the teams and members who can watch “{playlist?.name}”.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ShareRecipients
            teams={teams}
            members={others}
            teamIds={teamIds}
            userIds={userIds}
            onToggleTeam={toggle(setTeamIds)}
            onToggleUser={toggle(setUserIds)}
          />
        )}
        {demo && (
          <Callout tone="warning" icon={<AlertTriangle />}>
            The sample game can’t be shared. Import one of your own games to share its clips.
          </Callout>
        )}
        {!demo && prepare > 0 && (
          <Callout tone="neutral" icon={<CloudUpload />}>
            {prepare === 1 ? "1 clip will be prepared from your cloud copy." : `${prepare} clips will be prepared from your cloud copies.`}
          </Callout>
        )}
        {!demo && noCopy > 0 && (
          <Callout tone="warning" icon={<AlertTriangle />}>
            {noCopy === 1
              ? "1 clip comes from a game without a cloud copy, so recipients won’t see it. "
              : `${noCopy} clips come from games without a cloud copy, so recipients won’t see them. `}
            <Link href="/library" className="font-medium text-primary underline-offset-2 hover:underline">
              Upload the video in the Library
            </Link>
            .
          </Callout>
        )}
        <DialogFooter>
          {hasRecipients && (
            <Button variant="ghost" className="text-destructive sm:mr-auto" disabled={saving} onClick={() => save([], [])}>
              Stop sharing
            </Button>
          )}
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || loading || demo} onClick={() => save([...teamIds], [...userIds])}>
            {saving && <Loader2 className="animate-spin" />}
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
