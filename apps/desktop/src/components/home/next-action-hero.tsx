/**
 * The Home page's single next action — same visual language as the player
 * feed's hero (PlaylistFeed.tsx). The kind comes from the tested
 * computeHomeHero in @scoutable/shared/lib/home-hero; this component only
 * owns copy and navigation.
 */
import { useNavigate } from "react-router-dom";
import { ListVideo, Loader2, Plus, Send, Share2, Film, Download } from "lucide-react";
import type { HomeHero } from "@scoutable/shared/lib/home-hero";
import { Button } from "@/components/ui/button";

export function NextActionHero({
  hero,
  playerVoice = false,
  onRemind,
  reminding,
}: {
  hero: HomeHero;
  /** Personal-space declared players read "highlight tape", not "playlist". */
  playerVoice?: boolean;
  /** Sends reminders scoped to the hero's playlist (the newest one behind). */
  onRemind: () => void;
  reminding: boolean;
}) {
  const navigate = useNavigate();

  if (hero.kind === "caught-up") return null;

  const content = (() => {
    switch (hero.kind) {
      case "import-first":
        return {
          title: "Import your first game",
          body: "Every clip is generated automatically from the play-by-play.",
          ctaIcon: Plus,
          ctaLabel: "Import game",
          onCta: () => navigate("/upload"),
          secondary: hero.demoMatchId
            ? {
                label: "Browse the sample game",
                onClick: () => navigate(`/matches/${hero.demoMatchId}`),
              }
            : undefined,
        };
      case "build-playlist":
        return {
          title: playerVoice ? "Build your first highlight tape" : "Build your first playlist",
          body: playerVoice
            ? "Filter clips by player or event and pull your best plays together."
            : "Filter clips by player or event and pull the best ones together.",
          ctaIcon: ListVideo,
          ctaLabel: "New playlist",
          onCta: () => navigate("/playlists", { state: { createNew: true } }),
        };
      case "add-clips":
        return {
          title: `Add clips to "${hero.playlist.name}"`,
          body: "Open it and pull in clips from your games.",
          ctaIcon: Film,
          ctaLabel: "Add clips",
          onCta: () =>
            navigate("/playlists", {
              state: { restore: { playlistId: hero.playlist.id }, highlight: "add-clips" },
            }),
        };
      case "share":
        return {
          title: `Share "${hero.playlist.name}" with your team`,
          body: "Players get notified, and you'll see who watched what.",
          ctaIcon: Share2,
          ctaLabel: "Share playlist",
          onCta: () =>
            navigate("/playlists", {
              state: { restore: { playlistId: hero.playlist.id }, highlight: "share" },
            }),
        };
      case "export":
        return {
          title: `Export "${hero.playlist.name}" as MP4`,
          body: "Save a video file you can share anywhere.",
          ctaIcon: Download,
          ctaLabel: "Export",
          onCta: () =>
            navigate("/playlists", {
              state: { restore: { playlistId: hero.playlist.id }, highlight: "export" },
            }),
        };
      case "remind":
        return {
          title:
            hero.behindCount === 1
              ? `1 player hasn't finished watching "${hero.playlistName}"`
              : `${hero.behindCount} players haven't finished watching "${hero.playlistName}"`,
          body: "Send a nudge — each gets an email linking straight to the playlist.",
          ctaIcon: Send,
          ctaLabel: "Remind them",
          onCta: onRemind,
          ctaBusy: reminding,
          secondary: {
            label: "Open dashboard",
            onClick: () => navigate("/my-playlists"),
          },
        };
    }
  })();

  const Icon = content.ctaIcon;

  return (
    <div className="flex flex-col gap-4 rounded-window bg-primary/8 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-subheadline font-semibold text-primary">Next up</p>
        <p className="mt-1 truncate text-title-2 text-foreground">{content.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{content.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {content.secondary && (
          <Button variant="ghost" onClick={content.secondary.onClick}>
            {content.secondary.label}
          </Button>
        )}
        <Button onClick={content.onCta} disabled={content.ctaBusy}>
          {content.ctaBusy ? <Loader2 className="animate-spin" /> : <Icon />}
          {content.ctaLabel}
        </Button>
      </div>
    </div>
  );
}
