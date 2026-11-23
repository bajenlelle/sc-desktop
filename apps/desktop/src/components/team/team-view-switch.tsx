import { ChartColumn, Film } from "lucide-react";
import { useToolbarCompact } from "@/components/shell/toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type TeamView = "season" | "plays";

/**
 * The team page's two views, Season and Plays, leading in the toolbar after
 * Back, as the game page's Game | Stats switch sits (game-view-switch.tsx), and like it icons only in a
 * compact toolbar.
 */
export function TeamViewSwitch({ value, onChange }: { value: TeamView; onChange: (view: TeamView) => void }) {
  const compact = useToolbarCompact();
  const name = (text: string) => (compact ? <span className="sr-only">{text}</span> : text);
  return (
    <SegmentedControl
      size="md"
      aria-label="View"
      value={value}
      onValueChange={onChange}
      options={[
        { value: "season", label: name("Season"), icon: <ChartColumn />, title: "Their season: what stands out, how they play, players and games" },
        { value: "plays", label: name("Plays"), icon: <Film />, title: "Their plays in your games" },
      ]}
    />
  );
}
