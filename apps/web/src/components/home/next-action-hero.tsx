"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Film, ListVideo, Loader2, Plus, Send, Share2, Smartphone, type LucideIcon } from "lucide-react";
import type { HomeHero } from "@scoutable/shared/lib/home-hero";
import { ImportEntryLink } from "@/components/import/import-entry-link";
import { Button } from "@/components/ui/button";

/**
 * Home's single next action. The kind comes from the tested computeHomeHero
 * in @scoutable/shared/lib/home-hero; this component only owns the copy and
 * where each action goes. A port of the desktop's next-action-hero.tsx: the
 * same visual language as the player feed's hero.
 */
export function NextActionHero({
  hero,
  onNewPlaylist,
  creating,
  addClipsHref,
  onShare,
  onRemind,
  reminding,
  demoHref,
}: {
  hero: HomeHero;
  onNewPlaylist: () => void;
  creating: boolean;
  /** The editor on a playlist, with the add-clips panel open on a game when one has a cloud copy. */
  addClipsHref: (playlistId: string) => string;
  /** Opens the share dialog for the hero's playlist. */
  onShare: (playlistId: string) => void;
  /** Sends reminders scoped to the hero's playlist (the newest one behind). */
  onRemind: () => void;
  reminding: boolean;
  /** The sample game's page, when it has a cloud copy to browse; else null. */
  demoHref: string | null;
}) {
  const router = useRouter();

  if (hero.kind === "caught-up") return null;

  type Content = {
    title: string;
    body: string;
    icon: LucideIcon;
    label: string;
    /** The primary action: a handler, or a link rendered in its place. */
    onCta?: () => void;
    cta?: React.ReactNode;
    busy?: boolean;
    secondary?: { label: string; href: string };
  };

  const content = ((): Content => {
    switch (hero.kind) {
      case "import-first":
        return {
          title: "Import your first game",
          body: "Pick a league game and upload its video; every play becomes a clip.",
          icon: Plus,
          label: "Import a game",
          cta: (
            <Button asChild>
              <ImportEntryLink placement="get_started">
                <Plus />
                Import a game
              </ImportEntryLink>
            </Button>
          ),
          secondary: demoHref ? { label: "Browse the sample game", href: demoHref } : undefined,
        };
      case "build-playlist":
        return {
          title: "Build your first playlist",
          body: "Filter clips by player or event and pull the best ones together.",
          icon: ListVideo,
          label: "New playlist",
          onCta: onNewPlaylist,
          busy: creating,
        };
      case "add-clips":
        return {
          title: `Add clips to “${hero.playlist.name}”`,
          body: "Open it and pull in clips from your games.",
          icon: Film,
          label: "Add clips",
          onCta: () => router.push(addClipsHref(hero.playlist.id)),
        };
      case "share":
        return {
          title: `Share “${hero.playlist.name}” with your team`,
          body: "Players get an email, and you see who watched what.",
          icon: Share2,
          label: "Share playlist",
          onCta: () => onShare(hero.playlist.id),
        };
      case "export": {
        // Personal spaces that never made a highlight link: the editor opens on the export dialog.
        const editorHref = `/playlists/${encodeURIComponent(hero.playlist.id)}`;
        return {
          title: `Send “${hero.playlist.name}” to your phone`,
          body: "Get a link and a QR code, then save or share the video from your phone.",
          icon: Smartphone,
          label: "Send to my phone",
          onCta: () => router.push(`${editorHref}?export=share`),
          secondary: { label: "Download video", href: `${editorHref}?export=download` },
        };
      }
      case "remind":
        return {
          title:
            hero.behindCount === 1
              ? `1 player hasn't finished watching “${hero.playlistName}”`
              : `${hero.behindCount} players haven't finished watching “${hero.playlistName}”`,
          body: "Send a nudge: each gets an email linking straight to the playlist.",
          icon: Send,
          label: "Remind them",
          onCta: onRemind,
          busy: reminding,
          secondary: { label: "Open dashboard", href: "/my-playlists" },
        };
    }
  })();

  const Icon = content.icon;

  return (
    <section aria-label="Next up" className="flex flex-col gap-4 rounded-window bg-primary/8 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-subheadline font-semibold text-primary">Next up</p>
        <p className="mt-1 truncate text-title-2 text-foreground">{content.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{content.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {content.secondary && (
          <Button asChild variant="ghost">
            <Link href={content.secondary.href}>{content.secondary.label}</Link>
          </Button>
        )}
        {content.cta ?? (
          <Button onClick={content.onCta} disabled={content.busy}>
            {content.busy ? <Loader2 className="animate-spin" /> : <Icon />}
            {content.label}
          </Button>
        )}
      </div>
    </section>
  );
}
