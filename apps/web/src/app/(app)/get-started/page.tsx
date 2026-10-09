import Link from "next/link";
import { ChevronRight, CreditCard, Download, Film, ListVideo, Share2, Ticket } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { GroupFooter, GroupHeader, GroupedList } from "@/components/ui/group";
import { RolePrompt } from "@/components/role-prompt";
import { Page, PageContent } from "@/components/shell/page";
import { Toolbar } from "@/components/shell/toolbar";

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

  const rowClass =
    "flex min-h-11 items-center gap-3 px-4 py-2 text-sm text-foreground outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection";

  return (
    <Page width="narrow">
      <Toolbar title="Get started" />
      <PageContent className="space-y-7">
        <RolePrompt />

        <section className="flex flex-col items-center gap-3 rounded-window bg-card px-6 py-8 text-center ring-1 ring-separator">
          <LogoMark className="size-14 rounded-[13px] shadow-sm ring-1 ring-black/5" />
          <h2 className="text-title-1 text-foreground">Welcome to Scoutable</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Scouting lives in the desktop app. Download it, sign in with this account, and you&apos;ll find a
            sample game ready to explore.
          </p>
          <Button asChild className="mt-2">
            <a href="https://scoutable.se/#download" target="_blank" rel="noreferrer">
              <Download />
              Download the desktop app
            </a>
          </Button>
        </section>

        <section>
          <GroupHeader title="In the desktop app" />
          <GroupedList>
            {steps.map((step) => (
              <div key={step.title} className="flex items-start gap-3 px-4 py-3">
                <step.icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="text-callout text-muted-foreground">{step.body}</p>
                </div>
              </div>
            ))}
          </GroupedList>
          <GroupFooter>On the web you can watch playlists shared with you and manage your plan.</GroupFooter>
        </section>

        <GroupedList>
          <Link href="/onboarding" className={rowClass}>
            <Ticket className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Joining a team? Enter your invite code</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
          </Link>
          <Link href="/profile" className={rowClass}>
            <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Manage your plan</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
          </Link>
        </GroupedList>
      </PageContent>
    </Page>
  );
}
