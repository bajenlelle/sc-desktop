"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Clapperboard, Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GameVideo } from "@scoutable/shared/lib/game-videos-db";
import type { ScheduleGame } from "@scoutable/shared/lib/genius";
import { decideImportView, readImportView, writeImportView, type ImportView } from "@scoutable/shared/lib/import-picker";
import { importAnchor, importAnchorForMatch, type ImportAnchor } from "@scoutable/shared/lib/import-session";
import { fetchGameData, getSeasonStages } from "@scoutable/shared/lib/league-schedule";
import { choiceFor, spacesSharingAnswer, teamRoleIn, teamSpaces } from "@scoutable/shared/lib/league-teams";
import { getMatch } from "@scoutable/shared/lib/matches-db";
import { sortOrgsClubFirst } from "@scoutable/shared/lib/orgs";
import type { League } from "@scoutable/shared/types/league";
import type { StoredMatch } from "@scoutable/shared/types/match";
import { useAuth } from "@/components/auth-context";
import { ConvertFailedCard } from "@/components/game/convert-failed-card";
import { ConvertingCard } from "@/components/game/converting-card";
import { UploadCard } from "@/components/game/upload-card";
import { PickFile } from "@/components/import/pick-file";
import { PickGame, type PickedGame } from "@/components/import/pick-game";
import { useImportChecks } from "@/components/import/use-import-checks";
import { BackButton } from "@/components/shell/back-button";
import { useNavUser } from "@/components/shell/nav";
import { PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";
import { StatusScreen } from "@/components/status-screen";
import { TeamCrest } from "@/components/team-picker";
import { TeamDialog } from "@/components/team-dialog";
import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { trackEvent } from "@/lib/analytics";
import { useGameUploadJob } from "@/lib/game-upload";
import { useGameVideoRow, useMyGameVideos } from "@/lib/game-videos";
import { fadeVariants } from "@/lib/motion";
import { createClient } from "@/lib/supabase/client";
import { useLeagues } from "@/lib/use-leagues";
import { useMyTeam } from "@/lib/my-team";

type Phase = "pick_game" | "pick_file" | "uploading" | "converting" | "failed" | "done";

/** A game the flow is on: picked here, or resumed from `?match=`. */
interface Current {
  match: StoredMatch;
  /** Null while a resumed flow is still working it out. */
  anchor: ImportAnchor | null;
  isUpdate: boolean;
}

const storage = () => (typeof window === "undefined" ? null : window.localStorage);

/**
 * The anchor for a game already in the library (a reload mid-flow, or
 * "Upload the video" on a game imported earlier): off the match itself where
 * it can be read, else fetched from the feed again through the catalogue.
 * Never fails: without a reference time the server skips detection and the
 * user sets the tip-off by hand.
 */
async function anchorForExistingMatch(supabase: SupabaseClient, match: StoredMatch, leagues: League[]): Promise<ImportAnchor> {
  const known = importAnchorForMatch(match);
  if (known) return known;
  const league = leagues.find((l) => l.id === match.leagueId);
  const season = league?.seasons.find((s) => s.id === match.seasonId);
  if (!league || !season || !match.sourceGameId) return importAnchor(null);
  try {
    const stages = await getSeasonStages(supabase, league, season).catch(() => season.stages);
    const stage = stages.find((s) => s.id === match.stageId) ?? null;
    const when = match.date ? `${match.date}T00:00:00Z` : "";
    const side = (name: string) => ({ names: { short: name, long: name }, score: 0, icon: "", status: "COMPLETE" });
    const game: ScheduleGame = {
      uuid: match.sourceGameId,
      rawStartDateTime: when,
      startDateTime: when,
      homeTeamInfo: side(match.homeTeam.name),
      awayTeamInfo: side(match.awayTeam.name),
      venueInfo: { name: "" },
    };
    return importAnchor(await fetchGameData(supabase, season, game, stage));
  } catch (err) {
    console.error("[import] anchor refetch failed", err);
    return importAnchor(null);
  }
}

/**
 * The import flow: pick a league game, choose its video, upload it, and
 * follow the conversion. The phase follows the data rather than a state
 * machine (the picked game, this device's upload job, the game's row), so a
 * reload with `?match=` lands on the same step, and leaving the page loses
 * nothing: the upload runs on in the store and the row is polled wherever
 * the user is.
 */
export function ImportFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchParam = searchParams.get("match");
  const { activeOrgId, activeOrg, myOrgs, profile, profileLoading } = useAuth();
  const navUser = useNavUser();
  const { choices, loaded: teamsLoaded } = useMyTeam();
  const leagues = useLeagues();
  const checks = useImportChecks(activeOrgId);

  // Your games or all games: the space's own team unless it has none or
  // chose "All games" before; a choice made here is remembered per space.
  const activeChoice = choiceFor(choices, activeOrgId);
  const team = activeChoice?.team ?? null;
  const [viewChoice, setViewChoice] = useState<{ forTeam: string | null; view: ImportView } | null>(null);
  const view: ImportView =
    viewChoice && viewChoice.forTeam === (team?.id ?? null) ? viewChoice.view : decideImportView(team?.id, readImportView(storage(), activeOrgId));
  function changeView(next: ImportView) {
    if (next === view) return;
    setViewChoice({ forTeam: team?.id ?? null, view: next });
    writeImportView(storage(), activeOrgId, next);
    trackEvent("import_view_changed", { view: next, surface: "web" });
  }
  const [teamPromptOpen, setTeamPromptOpen] = useState(false);

  // The game: picked here, or resumed from the URL.
  const [picked, setPicked] = useState<PickedGame | null>(null);
  const [resumed, setResumed] = useState<{ matchId: string; current: Current | null } | null>(null);
  const resumeId = matchParam && picked?.match.id !== matchParam ? matchParam : null;
  useEffect(() => {
    if (!resumeId || profileLoading) return;
    let cancelled = false;
    const supabase = createClient();
    void getMatch(supabase, resumeId).then(async (match) => {
      if (cancelled) return;
      if (!match) {
        setResumed({ matchId: resumeId, current: null });
        return;
      }
      setResumed({ matchId: resumeId, current: { match, anchor: null, isUpdate: true } });
      const anchor = await anchorForExistingMatch(supabase, match, leagues);
      if (!cancelled) setResumed({ matchId: resumeId, current: { match, anchor, isUpdate: true } });
    });
    return () => {
      cancelled = true;
    };
    // The catalogue only matters for the one-off refetch; a later refresh needn't redo it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, profileLoading]);

  const current: Current | null = picked
    ? { match: picked.match, anchor: picked.anchor, isUpdate: picked.isUpdate }
    : resumed?.matchId === resumeId
      ? resumed.current
      : null;
  const resumeLoading = !!resumeId && resumed?.matchId !== resumeId;
  const resumeMissing = !!resumeId && resumed?.matchId === resumeId && resumed.current === null;

  const matchId = current?.match.id ?? null;
  const { video: leadRow, loaded: videoLoaded, reload: reloadVideo } = useGameVideoRow(matchId);
  const job = useGameUploadJob(matchId);
  // A replacement on its way (uploading, or converting) sits behind the
  // game's ready copy, the row that speaks for the game elsewhere; here it
  // is the one to follow. Finishing its upload replaces the copy, so no
  // second question about that.
  const { games: allRows } = useMyGameVideos();
  const pendingReplacement = useMemo(
    () =>
      matchId && leadRow?.status === "ready"
        ? (allRows?.find((g) => g.matchId === matchId && (g.status === "uploading" || g.status === "converting")) ?? null)
        : null,
    [allRows, matchId, leadRow?.status],
  );
  const video = pendingReplacement ?? leadRow;
  // An interrupted upload's row carries the anchor the function already has.
  const anchor: ImportAnchor | null = useMemo(() => {
    if (video && video.origin === "browser" && video.anchorKind) {
      return { kind: video.anchorKind, label: video.anchorLabel ?? "the tip-off", realWorldTime: video.anchorRealWorldTime };
    }
    return current?.anchor ?? null;
  }, [video, current?.anchor]);

  // A game whose video is in the cloud already lands on "ready"; the user can
  // still ask for another file, which replaces the copy once it is up.
  const [replaceWanted, setReplaceWanted] = useState<string | null>(null);
  const replacing = !!current && replaceWanted === current.match.id && leadRow?.status === "ready" && !(job && job.phase !== "checking");

  const phase: Phase = !current
    ? "pick_game"
    : job && job.phase !== "checking"
      ? "uploading"
      : video?.status === "converting"
        ? "converting"
        : video?.status === "ready" && !replacing
          ? "done"
          : video?.status === "failed"
            ? "failed"
            : "pick_file";

  function handlePicked(next: PickedGame) {
    setPicked(next);
    // The URL names the game, so a reload lands on the same step.
    router.replace(`/library/import?match=${encodeURIComponent(next.match.id)}`, { scroll: false });
  }

  const canImport = navUser?.canImport ?? null;
  const title = phase === "pick_game" ? "Import a game" : (current?.match.title ?? "Import a game");
  const viewToggle =
    team && phase === "pick_game" ? (
      <SegmentedControl
        aria-label="Which games"
        value={view}
        onValueChange={changeView}
        options={[
          { value: "team", label: team.name, icon: <TeamCrest team={team} size={14} /> },
          { value: "all", label: "All games" },
        ]}
      />
    ) : undefined;

  return (
    <>
      <Toolbar inline title={title} leading={<BackButton href="/library" label="Library" />} principal={viewToggle} />
      <PageContent>
        {profileLoading || canImport === null || (phase !== "pick_game" && !videoLoaded) || resumeLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !canImport ? (
          <StatusScreen
            icon={<Clapperboard />}
            title="Importing isn't available here"
            body="Games are imported by a club's coaches and admins, or in your personal space."
            actions={
              <Button asChild variant="outline">
                <Link href="/library">Library</Link>
              </Button>
            }
          />
        ) : resumeMissing ? (
          <StatusScreen
            icon={<Clapperboard />}
            title="This game isn't in your library"
            actions={
              <Button asChild variant="outline">
                <Link href="/library/import">Import a game</Link>
              </Button>
            }
          />
        ) : (
          <AutoHeight>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={phase} variants={fadeVariants} initial="hidden" animate="visible" exit="exit">
                {phase === "pick_game" && (
                  <div className="space-y-4">
                    {/* The toolbar's switcher shows beside the sidebar; narrower screens get it here. */}
                    {viewToggle && <div className="flex *:flex-1 [&>*>*]:flex-1 lg:hidden">{viewToggle}</div>}
                    <PickGame
                      orgId={activeOrgId}
                      view={team ? view : "all"}
                      onViewChange={changeView}
                      team={team}
                      canSetTeam={teamsLoaded && !team && !activeChoice?.unlistedTeam && !!activeOrg && !activeOrg.isNtOrg}
                      onSetTeam={() => setTeamPromptOpen(true)}
                      checks={checks}
                      onPicked={handlePicked}
                    />
                  </div>
                )}
                {phase === "pick_file" && current && (
                  <PickFile
                    match={current.match}
                    anchor={anchor}
                    isUpdate={current.isUpdate}
                    video={video}
                    job={job}
                    resumeReplaces={pendingReplacement?.status === "uploading"}
                  />
                )}
                {phase === "uploading" && job && <UploadCard job={job} />}
                {phase === "converting" && video && <ConvertingCard video={video} />}
                {phase === "failed" && video && <ConvertFailedCard video={video} onChanged={() => void reloadVideo()} />}
                {phase === "done" && current && video && (
                  <DoneScreen match={current.match} video={video} onReplace={() => setReplaceWanted(current.match.id)} />
                )}
              </motion.div>
            </AnimatePresence>
          </AutoHeight>
        )}
      </PageContent>

      {teamPromptOpen && activeOrg && (
        <TeamDialog
          mode="change"
          org={activeOrg}
          otherSpaces={sortOrgsClubFirst(teamSpaces(myOrgs)).filter((o) => o.orgId !== activeOrg.orgId)}
          defaultChecked={spacesSharingAnswer(teamSpaces(myOrgs), choices, activeOrg.orgId).filter((id) => id !== activeOrg.orgId)}
          initialTeamId={null}
          role={teamRoleIn(activeOrg, profile?.declaredRole)}
          onDone={() => setTeamPromptOpen(false)}
          onDismiss={() => setTeamPromptOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The game is ready to watch; what to do about the tip-off depends on what
 * the converter found and whether the user has set the sync since (the row's
 * status; a freshly re-saved match in memory carries no sync point).
 */
function DoneScreen({ match, video, onReplace }: { match: StoredMatch; video: GameVideo; onReplace: () => void }) {
  const synced =
    video.syncStatus === "confirmed" || video.syncStatus === "manual" || typeof match.syncPoint?.syncVideoTime === "number";
  const body =
    video.syncStatus === "applied"
      ? "We found the tip-off and lined the plays up. Check it when you open the game."
      : synced
        ? "Every play is lined up with the video."
        : video.anchorKind === "first_basket"
          ? "Set the first basket to line the plays up."
          : "Set the tip-off to line the plays up.";
  return (
    <StatusScreen
      icon={<Clapperboard />}
      title="Your game is ready"
      body={body}
      className="min-h-[18rem] bg-transparent"
      actions={
        <>
          <Button asChild>
            <Link href={`/library/${encodeURIComponent(match.id)}?from=library`}>Watch the game</Link>
          </Button>
          <Button variant="ghost" onClick={onReplace}>
            Upload a different video
          </Button>
        </>
      }
    />
  );
}
