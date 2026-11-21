import { ChartColumn, Film } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type TeamView = "season" | "plays";

/**
 * The team page's two views, Season and Plays, leading in the toolbar after
 * Back, as the game page's Game | Stats switch sits (game-view-switch.tsx).
 */
export function TeamViewSwitch({ value, onChange }: { value: TeamView; onChange: (view: TeamView) => void }) {
  return (
    <SegmentedControl
      size="md"
      aria-label="View"
      value={value}
      onValueChange={onChange}
      options={[
        { value: "season", label: "Season", icon: <ChartColumn />, title: "Their season: what stands out, how they play, players and games" },
        { value: "plays", label: "Plays", icon: <Film />, title: "Their plays in your games" },
      ]}
    />
  );
}
