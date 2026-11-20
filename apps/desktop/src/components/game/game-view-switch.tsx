import { ChartColumn, Film, SlidersHorizontal } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type GameViewMode = "game" | "stats" | "details";

/**
 * The game page's three views: the game itself, the game as numbers, and its
 * settings, as one control in the same place on every toolbar. Leading, not
 * centred, for the reason the playlist's Clips | Report switch is
 * (playlist-view-switch.tsx): the game view's toolbar carries a wide "Adding
 * to" control and a long title, which leave no stable centre.
 */
export function GameViewSwitch({ value, onChange }: { value: GameViewMode; onChange: (view: GameViewMode) => void }) {
  return (
    <SegmentedControl
      size="md"
      aria-label="View"
      value={value}
      onValueChange={onChange}
      options={[
        { value: "game", label: "Game", icon: <Film />, title: "The whole game: its video, its plays and its score" },
        { value: "stats", label: "Stats", icon: <ChartColumn />, title: "Box score, shots and lineups" },
        { value: "details", label: "Details", icon: <SlidersHorizontal />, title: "Title, video, sync and rosters" },
      ]}
    />
  );
}
