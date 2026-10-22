"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isStaffRole } from "@scoutable/shared/lib/orgs";
import { getLicenseState } from "@scoutable/shared/lib/license-state";
import {
  EMPTY_SELECTION,
  autoGameIds,
  buildMoveTree,
  clearGames,
  clearPlaylists,
  duplicateLabel,
  folderCheckState,
  isEverythingSelected,
  moveConfirmBody,
  moveConfirmNotes,
  moveConfirmTitle,
  moveErrorMessage,
  moveItemsLabel,
  moveResultLabel,
  selectAllGames,
  selectAllPlaylists,
  summarizeSelection,
  toRequest,
  toggleFolder,
  toggleGame,
  togglePlaylist,
  countNoun,
  type CheckState,
  type MoveTreeNode,
} from "@scoutable/shared/lib/space-move";
import { MoveError } from "@scoutable/shared/lib/space-move-db";
import type { MovePreview, MoveResult, MoveSelection } from "@scoutable/shared/types/space-move";
import { useAuth } from "@/components/auth-context";
import { EmptyState } from "@/components/empty-state";
import { BackButton } from "@/components/shell/back-button";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GroupFooter, GroupHeader, GroupRow, GroupedList } from "@/components/ui/group";
import { PopUpButton } from "@/components/ui/pop-up-button";
import { trackEvent } from "@/lib/analytics";
import { getMoveToClubPreview, moveToClub } from "@/lib/space-move-db";
import { cn } from "@/lib/utils";

/** A checkbox that can show "some of these" (a partly ticked folder). */
function TriCheckbox({
  state,
  disabled,
  onToggle,
  label,
}: {
  state: CheckState;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === "checked"}
      disabled={disabled}
      onChange={onToggle}
      className="size-3.5 shrink-0 rounded accent-primary disabled:opacity-60"
    />
  );
}

function formatGameDate(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function MoveToClubPage() {
  const router = useRouter();
  const { myOrgs, activeOrgId, setActiveOrg } = useAuth();

  const clubs = useMemo(
    () =>
      myOrgs
        .filter((o) => !o.isPersonal && isStaffRole(o.role))
        .map((o) => ({ ...o, locked: getLicenseState(o.expiresAt) === "locked" }))
        .sort((a, b) => a.orgName.localeCompare(b.orgName, "sv", { sensitivity: "base" })),
    [myOrgs],
  );
  // The club the user picked, else the active space when it's one of them,
  // else the first one that isn't locked.
  const [chosenClubId, setChosenClubId] = useState<string | null>(null);
  const club =
    clubs.find((c) => c.orgId === chosenClubId) ??
    clubs.find((c) => c.orgId === activeOrgId && !c.locked) ??
    clubs.find((c) => !c.locked) ??
    clubs[0] ??
    null;
  const clubId = club?.orgId ?? null;
  const clubName = club?.orgName ?? "the club";

  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current || clubs.length === 0) return;
    openedRef.current = true;
    trackEvent("content_move_opened", { clubs: clubs.length, origin: "web" });
  }, [clubs.length]);

  const [loadedPreview, setPreview] = useState<MovePreview | null>(null);
  // Only the picked club's preview, and none for a locked club.
  const preview =
    club && !club.locked && loadedPreview?.target.orgId === club.orgId ? loadedPreview : null;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<MoveSelection>(EMPTY_SELECTION);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [result, setResult] = useState<{ clubId: string; clubName: string; result: MoveResult } | null>(null);

  const load = useCallback(async (orgId: string, name: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const p = await getMoveToClubPreview(orgId);
      setPreview(p);
      setSel(EMPTY_SELECTION);
    } catch (e) {
      setPreview(null);
      const token = e instanceof MoveError ? e.token : "unknown";
      setLoadError(token === "unknown" ? "Your content couldn't be loaded. Try again." : moveErrorMessage(token, name));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!club || club.locked) return;
    void load(club.orgId, club.orgName);
  }, [club?.orgId, club?.locked, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => (preview ? buildMoveTree(preview) : { roots: [], unfiled: [] }), [preview]);
  const summary = useMemo(
    () => (preview ? summarizeSelection(tree, preview, sel) : null),
    [tree, preview, sel],
  );
  const auto = useMemo(() => (preview ? autoGameIds(preview, sel) : new Set<string>()), [preview, sel]);
  const nothingSelected = !summary || (summary.games === 0 && summary.playlists === 0 && summary.folders === 0);
  const empty = preview !== null && preview.playlists.length === 0 && preview.games.length === 0 && preview.folders.length === 0;

  async function handleMove() {
    if (!preview || !club || moving) return;
    const req = toRequest(tree, preview, sel);
    const s = summarizeSelection(tree, preview, sel);
    setMoving(true);
    try {
      const res = await moveToClub(club.orgId, req);
      trackEvent("content_moved", {
        games: res.gamesMoved + res.gamesMerged,
        playlists: res.playlistsMoved,
        folders: s.folders,
        auto_games: s.autoGames,
        merged: res.gamesMerged,
        second_copies: res.gamesKeptSeparate,
        select_all: isEverythingSelected(preview, sel),
        club_plan: club.planTier,
        origin: "web",
      });
      setConfirmOpen(false);
      setResult({ clubId: club.orgId, clubName: club.orgName, result: res });
      void load(club.orgId, club.orgName);
    } catch (e) {
      const token = e instanceof MoveError ? e.token : "unknown";
      trackEvent("content_move_failed", { error: token, origin: "web" });
      toast.error(moveErrorMessage(token, club.orgName));
      setConfirmOpen(false);
      if (token === "not_movable" || token === "demo_not_movable" || token === "folder_has_other_space_content") {
        void load(club.orgId, club.orgName);
      }
    } finally {
      setMoving(false);
    }
  }

  // The web has no library or playlist editor: the moved content is worked
  // on in the desktop app. Switching space here still lands the user in the
  // club, where its shared playlists and settings live.
  function openClub(orgId: string) {
    setActiveOrg(orgId);
    router.push("/my-playlists");
  }

  const renderFolder = (node: MoveTreeNode) => {
    const state = folderCheckState(tree, sel, node.folder.id);
    return (
      <div key={node.folder.id}>
        <label
          className="flex min-h-10 cursor-default items-center gap-3 py-2 pr-4"
          style={{ paddingLeft: 16 + node.depth * 20 }}
        >
          <TriCheckbox
            state={state}
            label={`Select folder ${node.folder.name}`}
            onToggle={() => setSel((s) => toggleFolder(tree, s, node.folder.id))}
          />
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm text-foreground">{node.folder.name}</span>
        </label>
        {node.children.map(renderFolder)}
        {node.playlists.map((p) => renderPlaylist(p, node.depth + 1))}
      </div>
    );
  };

  const renderPlaylist = (p: MovePreview["playlists"][number], depth: number) => {
    const extra = p.matchIds.length > 0 ? ` · brings ${countNoun(p.matchIds.length, "game", "games")}` : "";
    return (
      <label
        key={p.id}
        className="flex min-h-10 cursor-default items-center gap-3 py-2 pr-4"
        style={{ paddingLeft: 16 + depth * 20 }}
      >
        <TriCheckbox
          state={sel.playlistIds.has(p.id) ? "checked" : "unchecked"}
          label={`Select playlist ${p.name}`}
          onToggle={() => setSel((s) => togglePlaylist(tree, s, p.id))}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">{p.name}</span>
          <span className="text-callout text-muted-foreground">
            {countNoun(p.clipCount, "clip", "clips")}
            {extra}
          </span>
        </span>
      </label>
    );
  };

  return (
    <Page width="narrow">
      <Toolbar title="Move content to a club" leading={<BackButton href="/profile" label="Profile" />} />
      <PageContent>
        <div className="space-y-7 pb-4">
          <p className="px-1 text-sm text-muted-foreground">
            Moving takes games and playlists out of your personal space and into a club. You can&rsquo;t move them back.
          </p>

          {result && (
            <GroupedList>
              <GroupRow
                label={`Moved to ${result.clubName}`}
                description={`${moveResultLabel(result.result)}. Open them in the desktop app, in ${result.clubName}.`}
                trailing={
                  <Button size="sm" onClick={() => openClub(result.clubId)}>
                    Open {result.clubName}
                  </Button>
                }
              />
            </GroupedList>
          )}

          {clubs.length === 0 ? (
            <EmptyState
              title="No club to move into"
              body="Join or create a club as a coach or admin to move content there."
              action={
                <Button variant="outline" size="sm" onClick={() => router.push("/profile")}>
                  Back to profile
                </Button>
              }
            />
          ) : (
            <section>
              <GroupHeader title="Club" />
              <GroupedList>
                <GroupRow
                  label={clubs.length > 1 ? "Move into" : clubName}
                  description={club?.locked ? `${clubName}'s license has expired. Renew it to move content there.` : undefined}
                  trailing={
                    clubs.length > 1 ? (
                      <PopUpButton
                        aria-label="Club"
                        value={clubId}
                        onValueChange={(v) => {
                          setResult(null);
                          setChosenClubId(v);
                        }}
                        options={clubs.map((c) => ({
                          value: c.orgId,
                          label: c.orgName,
                          description: c.locked ? "License expired" : undefined,
                          disabled: c.locked,
                        }))}
                      />
                    ) : undefined
                  }
                />
              </GroupedList>
            </section>
          )}

          {loading && !preview && (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          {loadError && (
            <EmptyState
              title="Content couldn't be loaded"
              body={loadError}
              action={
                <Button variant="outline" size="sm" onClick={() => club && void load(club.orgId, club.orgName)}>
                  Try again
                </Button>
              }
            />
          )}

          {preview && empty && (
            <EmptyState
              title="Nothing to move"
              body="No games or playlists in your personal space."
              action={
                <Button variant="outline" size="sm" onClick={() => router.push("/profile")}>
                  Back to profile
                </Button>
              }
            />
          )}

          {preview && !empty && (
            <>
              <section>
                <GroupHeader
                  title="Playlists"
                  action={
                    preview.playlists.length + preview.folders.length > 0 && (
                      sel.playlistIds.size > 0 || sel.folderIds.size > 0 ? (
                        <Button variant="ghost" size="sm" onClick={() => setSel((s) => clearPlaylists(s))}>
                          Clear
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setSel((s) => selectAllPlaylists(tree, preview, s))}>
                          Select all
                        </Button>
                      )
                    )
                  }
                />
                {preview.playlists.length + preview.folders.length === 0 ? (
                  <GroupedList>
                    <GroupRow label="No playlists in your personal space." />
                  </GroupedList>
                ) : (
                  <GroupedList className="divide-y-0">
                    {tree.roots.map(renderFolder)}
                    {tree.unfiled.map((p) => renderPlaylist(p, 0))}
                  </GroupedList>
                )}
                <GroupFooter>A playlist brings the games its clips come from.</GroupFooter>
              </section>

              <section>
                <GroupHeader
                  title="Games"
                  action={
                    preview.games.length > 0 && (
                      sel.gameIds.size > 0 ? (
                        <Button variant="ghost" size="sm" onClick={() => setSel((s) => clearGames(s))}>
                          Clear
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setSel((s) => selectAllGames(preview, s))}>
                          Select all
                        </Button>
                      )
                    )
                  }
                />
                {preview.games.length === 0 ? (
                  <GroupedList>
                    <GroupRow label="No games in your personal space." />
                  </GroupedList>
                ) : (
                  <GroupedList>
                    {preview.games.map((g) => {
                      const isAuto = auto.has(g.id);
                      const dup = g.duplicate ? duplicateLabel(g.duplicate, clubName) : null;
                      const date = formatGameDate(g.gameDate);
                      return (
                        <label key={g.id} className="flex min-h-11 cursor-default items-center gap-3 px-4 py-2">
                          <TriCheckbox
                            state={isAuto || sel.gameIds.has(g.id) ? "checked" : "unchecked"}
                            disabled={isAuto}
                            label={`Select game ${g.title}`}
                            onToggle={() => setSel((s) => toggleGame(s, g.id))}
                          />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-sm text-foreground">{g.title}</span>
                            <span className="text-callout text-muted-foreground">
                              {[date, isAuto ? "Used by a playlist you're moving" : null].filter(Boolean).join(" · ")}
                            </span>
                            {dup && (
                              <span
                                className={cn("text-callout", g.duplicate?.mergeable ? "text-muted-foreground" : "text-warning")}
                                title={dup.detail ?? undefined}
                              >
                                {dup.label}
                                {dup.detail ? `. ${dup.detail}.` : ""}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </GroupedList>
                )}
                <GroupFooter>The sample game stays in your personal space.</GroupFooter>
              </section>
            </>
          )}
        </div>

        {preview && !empty && summary && (
          <div className="sticky bottom-[var(--tab-bar-height)] -mx-4 flex items-center justify-between gap-3 border-t border-separator bg-material-toolbar px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
            <span className="text-sm text-muted-foreground">
              {nothingSelected ? "Nothing selected" : moveItemsLabel(summary.games, summary.playlists, summary.folders)}
            </span>
            <Button disabled={nothingSelected || club?.locked} onClick={() => setConfirmOpen(true)}>
              Move to {clubName}…
            </Button>
          </div>
        )}

        <Dialog open={confirmOpen} onOpenChange={(v) => !moving && setConfirmOpen(v)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{summary ? moveConfirmTitle(summary, clubName) : ""}</DialogTitle>
              <DialogDescription>{moveConfirmBody(clubName)}</DialogDescription>
            </DialogHeader>
            {summary && moveConfirmNotes(summary, clubName).length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {moveConfirmNotes(summary, clubName).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={moving}>
                Cancel
              </Button>
              <Button onClick={handleMove} disabled={moving}>
                {moving && <Loader2 className="animate-spin" />}
                {moving ? "Moving…" : `Move to ${clubName}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContent>
    </Page>
  );
}
