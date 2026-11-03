/**
 * "How sync works": the one explanation of how clips are placed and what
 * each Fix sync choice moves, behind a small door in the Fix sync sheet and
 * on the game page. The four pictures are the sheet's own strip in a fixed
 * example state, so the explainer and the live choice teach with one image.
 */
import { HelpCircle } from "lucide-react";
import { syncReach, type SyncFixScope } from "@scoutable/shared/lib/sync-reach";
import type { SyncPoint } from "@scoutable/shared/types/match";
import { SyncReachStrip } from "@/components/editor/sync-reach-strip";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// A four-quarter game, with the example play 40% into Q3.
const T = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 18, minutes)).toISOString();
const quarter = (p: number, start: number, end: number) => ({
  startRealWorldTime: T(start),
  endRealWorldTime: T(end),
  anchor: { realWorldTime: T(start), kind: "period_start" as const, label: `Start of Q${p}` },
});
const EXAMPLE_GAME: SyncPoint = {
  syncVideoTime: 0,
  syncRealWorldTime: T(0),
  marks: { "1": quarter(1, 0, 20), "2": quarter(2, 22, 42), "3": quarter(3, 56, 76), "4": quarter(4, 78, 98) },
};
const EXAMPLE_PLAY = { period: 3, realWorldTime: T(64) };

const CHOICES: Array<{ scope: SyncFixScope; name: string; cause: string }> = [
  { scope: "clip", name: "Only this clip", cause: "one play was logged early or late." },
  { scope: "play", name: "From this play on", cause: "the recording jumps here." },
  { scope: "quarter", name: "From this quarter on", cause: "the breaks between quarters were cut out." },
  { scope: "game", name: "The whole game", cause: "the tip-off is a few seconds off." },
];
const EXAMPLES = CHOICES.map((c) => ({ ...c, reach: syncReach(EXAMPLE_GAME, [], EXAMPLE_PLAY, c.scope) }));

export function SyncHelpPopover({ align = "end" }: { align?: "start" | "center" | "end" }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          <HelpCircle />
          How sync works
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 space-y-3">
        <div className="space-y-1.5">
          <p className="text-headline">How sync works</p>
          <p className="text-callout text-muted-foreground">
            Scoutable places every play in your video by the game clock, counting from the tip-off you set. Each clip
            starts a few seconds before its play.
          </p>
          <p className="text-callout text-muted-foreground">
            If the video is missing time somewhere, every play after that point lands at the wrong moment. Fix sync tells
            Scoutable where one play really is, and how far the correction reaches:
          </p>
        </div>
        <div className="space-y-2.5">
          {EXAMPLES.map((e) => (
            <SyncReachStrip
              key={e.scope}
              reach={e.reach}
              tick={e.scope === "clip" ? "clip" : "play"}
              caption={
                <>
                  <span className="text-foreground">{e.name}:</span> {e.cause}
                </>
              }
            />
          ))}
        </div>
        <p className="text-callout text-muted-foreground">
          Not sure? Check a play from another quarter. If it's fine, the problem starts later.
        </p>
      </PopoverContent>
    </Popover>
  );
}
