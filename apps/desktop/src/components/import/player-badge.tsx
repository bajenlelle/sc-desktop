import type { GameBadge, GameBadgeTone } from "@scoutable/shared/lib/player-access";
import { cn } from "@/lib/utils";

const TONES: Record<GameBadgeTone, string> = {
  covered: "bg-primary/12 text-primary",
  free: "bg-muted text-muted-foreground",
  bought: "bg-muted text-muted-foreground",
  imported: "bg-muted text-muted-foreground",
  price: "text-foreground ring-1 ring-inset ring-separator",
};

/** What importing a game would use, in a Free personal space with sales on. */
export function PlayerBadge({ badge }: { badge: GameBadge }) {
  return (
    <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium nums", TONES[badge.tone])}>
      {badge.label}
    </span>
  );
}
