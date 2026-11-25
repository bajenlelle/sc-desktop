import type { ReactElement } from "react";
import { ChevronDown, Film, MapPin, Undo2, X } from "lucide-react";
import { describePlay, formatGameClock, periodLabel } from "@scoutable/shared/lib/events";
import { describeShiftSeconds, type SyncFix } from "@scoutable/shared/lib/sync-check";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { quietControl } from "@/components/ui/filter-button";
import { cn } from "@/lib/utils";
import type { PlayByPlayEvent } from "@/types/match";

/** A place in the video as m:ss. */
function videoClock(seconds: number): string {
  const t = Math.round(Math.max(0, seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** A fix in a few words: where it is, and what it did. */
function fixWords(fix: SyncFix, playOf: (eventId: number) => PlayByPlayEvent | undefined): { main: string; what: string } {
  if (fix.kind === "start") {
    return { main: `Game footage starts at ${videoClock(fix.seconds)}`, what: fix.plays === 1 ? "1 play not in the video" : `${fix.plays} plays not in the video` };
  }
  if (fix.kind === "cut") {
    // A move, not a delay: "8 s later" alone read as the plays running late.
    const what = fix.shift !== null && Math.abs(fix.shift) >= 0.05 ? `Moved ${describeShiftSeconds(fix.shift)}` : "Moved";
    return { main: fix.name, what };
  }
  const e = playOf(fix.eventId);
  const where = e ? [periodLabel(e.period), e.gameClockTime ? formatGameClock(e.gameClockTime) : null].filter(Boolean).join(" ") : periodLabel(fix.period);
  return { main: e ? `${where} · ${describePlay(e)}` : where, what: "Placed by you" };
}

/**
 * The fixes made in the game view, beside Check sync, for a game that has
 * any: each can be taken back on its own with the × at its end (the row
 * itself does nothing: a click on it wasn't read as taking the fix back), or
 * all at once. A fix taken back says so in a toast with Undo, as a fix made
 * does: no confirmation first. The menu stays open for the next one.
 */
export function SyncFixesMenu({
  fixes,
  playOf,
  onRemove,
  disabled,
}: {
  fixes: readonly SyncFix[];
  playOf: (eventId: number) => PlayByPlayEvent | undefined;
  onRemove: (fix: SyncFix | "all") => void;
  disabled?: boolean;
}): ReactElement | null {
  if (fixes.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" data-sync="fixes" className={cn(quietControl, "h-6 px-1.5 text-callout text-muted-foreground")}>
          {fixes.length === 1 ? "1 fix" : `${fixes.length} fixes`}
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="text-footnote font-normal text-muted-foreground">A removed fix's plays are placed by the sync again</DropdownMenuLabel>
        {fixes.map((fix) => {
          const words = fixWords(fix, playOf);
          return (
            <div
              key={fix.kind === "start" ? "start" : `${fix.kind}-${fix.realWorldTime}-${fix.eventId ?? ""}`}
              data-fix={fix.kind}
              className="flex items-center gap-2 rounded-[5px] py-1 pr-1 pl-2 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
            >
              {fix.kind === "cut" ? (
                <span className="w-4 shrink-0 text-center text-muted-foreground" aria-hidden>
                  //
                </span>
              ) : fix.kind === "start" ? (
                <Film className="text-muted-foreground" />
              ) : (
                <MapPin className="text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate nums">{words.main}</span>
              <span className="shrink-0 text-footnote text-muted-foreground nums">{words.what}</span>
              {/* The open game's × in the sidebar, here always shown: it is the one thing the row does. */}
              <DropdownMenuItem
                aria-label={`Remove fix: ${words.main}`}
                onSelect={(e) => {
                  e.preventDefault();
                  onRemove(fix);
                }}
                className="size-5 shrink-0 justify-center rounded-md p-0 text-muted-foreground transition-[background-color,color] duration-100 hover:bg-fill-3 hover:text-foreground focus:bg-fill-3 focus:text-foreground active:bg-fill-4 [&_svg]:size-3"
              >
                <X />
              </DropdownMenuItem>
            </div>
          );
        })}
        {fixes.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-fix="all" onSelect={() => onRemove("all")}>
              <Undo2 />
              Remove all fixes
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
