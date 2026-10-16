"use client";

/**
 * My Highlights — the player's own space as a first-class destination.
 *
 * Personal orgs exist so players acquired through club orgs can upgrade to
 * Rookie/Pro and cut their own tapes. Free tier sees a value-first pitch
 * whose only ask is the FREE desktop download — activation before
 * monetization: the free tier (3 imports) is the trial, and the upsell
 * happens inside the desktop app at the quota/watermark gates, where intent
 * is highest. Upgraded players see their own playlists (built in the
 * desktop app, listed here for reference — watching stays on their phone
 * via send-to-phone, or in the desktop app).
 */
import { useEffect, useState } from "react";
import { Clapperboard, ListVideo, Loader2, Monitor, Share2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { GroupFooter, GroupedList } from "@/components/ui/group";
import { useAuth } from "@/components/auth-context";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { listPlaylists } from "@scoutable/shared/lib/playlists-db";
import { isClipItem, type Playlist } from "@scoutable/shared/types/match";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";

const DESKTOP_APP_URL = "https://scoutable.se/#download";

// Media from the landing site (single source of truth for product footage):
// the /players hero recording — the editor panning a vertical crop across a
// play — is exactly what this page is selling.
const PITCH_VIDEO_WEBM = "https://scoutable.se/videos/hero-players.webm";
const PITCH_VIDEO_MP4 = "https://scoutable.se/videos/hero-players.mp4";
const PITCH_POSTER = "https://scoutable.se/posters/hero-players.jpg";
const PITCH_MEDIA_ALT = "The Scoutable editor cropping a play into a vertical highlight reel";

function PitchPage() {
  // Poster fallback when the video can't load — the old hotlinked screenshot
  // 404'd silently after a landing redesign, so never trust a single asset.
  const [videoFailed, setVideoFailed] = useState(false);

  function handleDownload() {
    // `placement`, not `source`: the landing site emits this same event keyed
    // on placement, and all three apps report into one PostHog project — a
    // second property shape just lands every click here in the "None" bucket
    // of any placement breakdown.
    trackEvent("download_clicked", { placement: "web_my_highlights" });
    window.open(DESKTOP_APP_URL, "_blank", "noreferrer");
  }

  const bullets = [
    {
      icon: Wand2,
      title: "Every clip, cut for you",
      body: "Import your own games and Scoutable auto-generates a named clip for every shot, rebound and steal — no scrubbing.",
    },
    {
      icon: Clapperboard,
      title: "Your tape, your story",
      body: "Drag your best plays into a highlight tape. Reorder, trim, add title cards.",
    },
    {
      icon: Share2,
      title: "Straight to your phone",
      body: "Scan a QR code and your tape is on your phone — ready for Instagram, TikTok or a recruiting DM.",
    },
  ];

  return (
    <div className="space-y-7">
      <section className="text-center">
        {/* Under the large title on narrow screens it steps down a size, so the page keeps one top heading. */}
        <h2 className="text-title-2 text-foreground lg:text-title-1">Build your own highlight tape</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          This is your space, separate from your club. Import your own games and turn them into tapes that are
          yours to keep and share.
        </p>
      </section>

      <div className="overflow-hidden rounded-window bg-black ring-1 ring-separator">
        {videoFailed ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={PITCH_POSTER} alt={PITCH_MEDIA_ALT} className="w-full" />
        ) : (
          <>
            <video
              className="w-full motion-reduce:hidden"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={PITCH_POSTER}
              aria-label={PITCH_MEDIA_ALT}
              onError={() => setVideoFailed(true)}
            >
              <source src={PITCH_VIDEO_WEBM} type="video/webm" />
              {/* Source errors fire on the element, not the video: the last
                  source failing means no playable source at all. */}
              <source src={PITCH_VIDEO_MP4} type="video/mp4" onError={() => setVideoFailed(true)} />
            </video>
            {/* Reduced motion: a still frame instead of the loop. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PITCH_POSTER} alt={PITCH_MEDIA_ALT} className="hidden w-full motion-reduce:block" />
          </>
        )}
      </div>

      <GroupedList>
        {bullets.map((b) => (
          <div key={b.title} className="flex items-start gap-3 px-4 py-3">
            <b.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{b.title}</p>
              <p className="text-callout text-muted-foreground">{b.body}</p>
            </div>
          </div>
        ))}
      </GroupedList>

      <div className="flex flex-col items-center gap-2">
        <Button size="lg" onClick={handleDownload}>
          <Monitor />
          Get the desktop app, free
        </Button>
        <p className="text-callout text-muted-foreground">No card needed.</p>
      </div>
    </div>
  );
}

function OwnPlaylists() {
  const { myOrgs } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  // My Highlights = the player's own reels, which live in the personal
  // space. Coach-org content reaches them via My Playlists → Shared with me.
  const personalOrgId = myOrgs.find((o) => o.isPersonal)?.orgId;

  useEffect(() => {
    if (!personalOrgId) return;
    listPlaylists(createClient(), personalOrgId, { includeUnscoped: true })
      .then(setPlaylists)
      .finally(() => setLoading(false));
  }, [personalOrgId]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <EmptyState
        icon={<ListVideo />}
        title="No tapes yet"
        body="Import a game in the desktop app and your playlists show up here."
        action={
          <Button variant="outline" size="sm" asChild>
            <a href={DESKTOP_APP_URL} target="_blank" rel="noreferrer">
              Get the desktop app
            </a>
          </Button>
        }
      />
    );
  }

  return (
    <section>
      <GroupedList>
        {playlists.map((pl) => (
          <div key={pl.id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
            <span className="truncate text-sm text-foreground">{pl.name}</span>
            <span className="shrink-0 text-callout text-muted-foreground nums">
              {pl.items.filter(isClipItem).length} clips
            </span>
          </div>
        ))}
      </GroupedList>
      <GroupFooter>
        Your own playlists, built in the desktop app. Send them to your phone from there to watch and share
        anywhere.
      </GroupFooter>
    </section>
  );
}

export default function MyHighlightsPage() {
  const { myOrgs, profileLoading } = useAuth();

  const personalOrg = myOrgs.find((o) => o.isPersonal) ?? null;
  const upgraded = personalOrg != null && personalOrg.planTier !== "free";

  return (
    <Page width="medium">
      <Toolbar title="My highlights" />
      <PageContent>
        {profileLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : upgraded ? (
          <OwnPlaylists />
        ) : (
          <PitchPage />
        )}
      </PageContent>
    </Page>
  );
}
