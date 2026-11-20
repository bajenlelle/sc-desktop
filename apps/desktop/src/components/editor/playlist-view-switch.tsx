import { FileText, ListVideo } from "lucide-react";
import { useToolbarCompact } from "@/components/shell/toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type PlaylistView = "clips" | "report";

/**
 * The playlist's two views, the clips (the video) and its scouting report,
 * as one control in the same place on both toolbars: a coach moves between
 * the footage and the write-up of the same playlist, it isn't something the
 * playlist exports. Leading, not centred: the clips toolbar's actions and a
 * long playlist name leave no stable centre. A dot marks a report that is
 * shared; its tooltip says until when.
 */
export function PlaylistViewSwitch({
  value,
  onChange,
  sharedStatus,
}: {
  value: PlaylistView;
  onChange: (view: PlaylistView) => void;
  /** "Shared · expires 19 Nov 2026" while the playlist has a live report, else null. */
  sharedStatus: string | null;
}) {
  // In a compact toolbar the two views show their icons, their names kept for the screen reader and the tooltip.
  const compact = useToolbarCompact();
  const name = (text: string) => (compact ? <span className="sr-only">{text}</span> : text);
  return (
    <SegmentedControl
      size="md"
      aria-label="View"
      value={value}
      onValueChange={onChange}
      options={[
        { value: "clips", label: name("Clips"), icon: <ListVideo />, title: "The playlist's clips" },
        {
          value: "report",
          label: (
            <>
              {name("Report")}
              {sharedStatus && <span aria-label="Shared" className="size-1.5 rounded-full bg-success" />}
            </>
          ),
          icon: <FileText />,
          title: sharedStatus ? `Scouting report · ${sharedStatus}` : "Scouting report: players, notes and clips to share",
        },
      ]}
    />
  );
}
