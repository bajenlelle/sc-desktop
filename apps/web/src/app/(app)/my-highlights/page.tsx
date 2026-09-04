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
import { Check, Clapperboard, ListVideo, Loader2, Monitor, Share2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/components/auth-context";
import { createClient } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { listPlaylists } from "@scoutable/shared/lib/playlists-db";
import { isClipItem, type Playlist } from "@scoutable/shared/types/match";

const DESKTOP_APP_URL = "https://scoutable.se/#download";

function PitchPage() {
  function handleDownload() {
    trackEvent("download_clicked", { source: "my_highlights" });
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
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">My Highlights</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Build your own highlight tape
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          This is your space — separate from your club. Import your own games and turn
          them into tapes that are yours to keep and share.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border border-border shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://scoutable.se/screenshot.png"
          alt="The Scoutable editor with a game automatically broken into clips"
          className="w-full"
        />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {bullets.map((b) => (
          <Card key={b.title}>
            <CardContent className="p-4">
              <b.icon className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="mt-2 text-sm font-semibold text-foreground">{b.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{b.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        <Button size="lg" className="min-h-11 px-8" onClick={handleDownload}>
          <Monitor className="mr-2 h-4 w-4" aria-hidden />
          Get the desktop app — free
        </Button>
        <p className="text-sm text-muted-foreground">
          3 game imports included. No card needed.
        </p>
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
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Highlights</h1>
        <Check className="h-5 w-5 text-primary" aria-hidden />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Your own playlists, built in the desktop app. Send them to your phone from there
        to watch and share anywhere.
      </p>

      {playlists.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-2 text-center">
          <ListVideo className="h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-base font-semibold text-foreground">No tapes yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Import a game in the{" "}
            <a
              href={DESKTOP_APP_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              desktop app
            </a>{" "}
            and your playlists show up here.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {playlists.map((pl) => (
            <li
              key={pl.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
            >
              <span className="truncate text-sm font-medium text-foreground">{pl.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {pl.items.filter(isClipItem).length} clips
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MyHighlightsPage() {
  const { myOrgs, profileLoading } = useAuth();

  if (profileLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const personalOrg = myOrgs.find((o) => o.isPersonal) ?? null;
  const upgraded = personalOrg != null && personalOrg.planTier !== "free";

  return upgraded ? <OwnPlaylists /> : <PitchPage />;
}
