import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { listMatchesLight } from "@/lib/matches-db";
import { listOwnPlaylistsAndShared } from "@/lib/playlists-db";
import { PLAYLISTS_CHANGED } from "@/lib/playlist-events";
import { useSidebarCollapsed } from "@/lib/sidebar-store";
import { trackEvent } from "@/lib/analytics";
import { ChecklistBody, useChecklist } from "@/components/getting-started";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { Playlist, StoredMatch } from "@/types/match";

/** What changes a step's games or playlists, from anywhere in the app. */
const RELOAD_ON = ["matches-changed", "demo-seeded", PLAYLISTS_CHANGED] as const;
/** Announcements often come in pairs (create, then add): one read for the burst. */
const RELOAD_DELAY_MS = 150;

const NO_MATCHES: StoredMatch[] = [];
const NO_PLAYLISTS: Playlist[] = [];

/**
 * Getting started at the bottom of the sidebar: the progress and the next
 * step, always in view, and the whole checklist in a popover when pressed.
 * It never opens by itself (guidance is pulled, not pushed), and its ×
 * dismisses it for good, like the one in the checklist. Shown only while the
 * checklist is (new signups who can act in this space), so everyone else
 * pays nothing: no reads, no listeners.
 */
export function GettingStartedCard() {
  const { activeOrgId, activeOrgIsPersonal } = useAuth();
  const collapsed = useSidebarCollapsed();
  const [open, setOpen] = useState(false);
  // The space the games and playlists were read for: another space's never stand in.
  const [data, setData] = useState<{ orgId: string | null; matches: StoredMatch[]; playlists: Playlist[] } | null>(null);
  const loaded = data !== null && data.orgId === (activeOrgId ?? null);
  const checklist = useChecklist(loaded ? data.matches : NO_MATCHES, loaded ? data.playlists : NO_PLAYLISTS);
  const wanted = checklist.show;

  useEffect(() => {
    if (!wanted) return;
    const orgId = activeOrgId ?? null;
    let latest = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const ticket = ++latest;
      try {
        const [matches, own] = await Promise.all([
          listMatchesLight(orgId ?? undefined, { ownOnly: true }),
          listOwnPlaylistsAndShared(orgId ?? undefined, { includeUnscoped: activeOrgIsPersonal }),
        ]);
        // A newer read has started (or the space changed): this answer is stale.
        if (disposed || ticket !== latest) return;
        setData({ orgId, matches, playlists: own.playlists });
      } catch {
        // Keep what was read last; the next announcement reads again.
      }
    };
    const reloadSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), RELOAD_DELAY_MS);
    };
    void load();
    for (const name of RELOAD_ON) window.addEventListener(name, reloadSoon);
    return () => {
      disposed = true;
      clearTimeout(timer);
      for (const name of RELOAD_ON) window.removeEventListener(name, reloadSoon);
    };
  }, [wanted, activeOrgId, activeOrgIsPersonal]);

  // Whenever the card is off screen (the sidebar collapsed, another space still
  // loading, the checklist hidden), its popover closes: it never comes back open.
  const shown = !collapsed && checklist.show && loaded;
  useEffect(() => {
    if (!shown) setOpen(false);
  }, [shown]);

  if (!shown) return null;

  const { steps, doneCount, next } = checklist;

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen) trackEvent("checklist_opened");
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className="group relative">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full flex-col gap-1.5 rounded-lg bg-fill-1 p-2.5 text-left outline-none transition-[background-color,transform] duration-100 hover:bg-fill-2 active:scale-[0.99] active:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection data-[state=open]:bg-fill-2"
          >
            {/* Room on the right for the ×, which sits over this row. */}
            <span className="pr-6 text-sm font-medium text-foreground">Getting started</span>
            <span className="flex items-center gap-2">
              <ProgressBar percent={(doneCount / steps.length) * 100} className="flex-1" />
              <span className="text-callout nums text-muted-foreground">
                {doneCount} of {steps.length}
              </span>
            </span>
            {next && <span className="truncate text-callout text-muted-foreground">{next.title}</span>}
          </button>
        </PopoverTrigger>
        <button
          type="button"
          onClick={checklist.dismiss}
          aria-label="Dismiss"
          className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color] duration-100 group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-fill-2 hover:text-foreground active:bg-fill-3 focus-visible:ring-2 focus-visible:ring-selection"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {/* Opens beside the sidebar and grows from the card (chrome-animate: a plain fade under reduced motion). */}
      <PopoverContent side="right" align="end" sideOffset={8} aria-label="Getting started" className="w-[360px] p-0">
        <ChecklistBody checklist={checklist} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
