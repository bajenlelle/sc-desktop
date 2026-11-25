import type { ReactElement } from "react";
import { ChevronDown, MapPin, Undo2 } from "lucide-react";
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

/** A fix in a few words: where it is, and what it did. */
function fixWords(fix: SyncFix, playOf: (eventId: number) => PlayByPlayEvent | undefined): { main: string; what: string } {
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
 * any: each can be taken back on its own, or all at once. A fix taken back
 * says so in a toast with Undo, as a fix made does: no confirmation first.
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
        <DropdownMenuLabel className="text-footnote font-normal text-muted-foreground">Remove a fix to place its plays by the sync again</DropdownMenuLabel>
        {fixes.map((fix) => {
          const words = fixWords(fix, playOf);
          return (
            <DropdownMenuItem key={`${fix.kind}-${fix.realWorldTime}-${fix.eventId ?? ""}`} data-fix={fix.kind} onSelect={() => onRemove(fix)}>
              {fix.kind === "cut" ? <span className="w-4 shrink-0 text-center text-muted-foreground" aria-hidden>//</span> : <MapPin className="text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate nums">{words.main}</span>
              <span className="ml-auto shrink-0 text-footnote text-muted-foreground nums">{words.what}</span>
            </DropdownMenuItem>
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
