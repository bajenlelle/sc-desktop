import Link from "next/link";
import { Download, Film, ListVideo, Share2, Ticket } from "lucide-react";

/**
 * Landing page for signed-in users whose only space is their personal org —
 * mainly fresh self-signups. The scouting workflow (import, clip, share)
 * lives in the desktop app, so the job of this page is to say that clearly
 * and hand over the download, instead of bouncing new users to a bare
 * profile page like before.
 */
export default function GetStartedPage() {
  const steps = [
    {
      icon: Film,
      title: "Import a game",
      body: "Pick a league game — every clip is generated automatically from the play-by-play.",
    },
    {
      icon: ListVideo,
      title: "Build playlists",
      body: "Filter clips by player, event or situation and pull them into playlists.",
    },
    {
      icon: Share2,
      title: "Share or export",
      body: "Send playlists to your team, or export them as MP4.",
    },
  ];

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-10 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Welcome to Scoutable 👋
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Scouting lives in the desktop app — download it, sign in with this account, and
          you&apos;ll find a sample game ready to explore.
        </p>
        <a
          href="https://www.scoutable.se/#download"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Download className="h-4 w-4" />
          Download the desktop app
        </a>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.title} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-5">
            <s.icon className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">{s.title}</h2>
            <p className="text-xs text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1.5 text-sm text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <Ticket className="h-3.5 w-3.5 text-primary/70" aria-hidden />
          Joining a team?{" "}
          <Link href="/onboarding" className="font-medium text-primary underline-offset-2 hover:underline">
            Enter your invite code
          </Link>
        </p>
        <p>
          On the web you can watch playlists shared with you and{" "}
          <Link href="/profile" className="font-medium text-primary underline-offset-2 hover:underline">
            manage your plan
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
