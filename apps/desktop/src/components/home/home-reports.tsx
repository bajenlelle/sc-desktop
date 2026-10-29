import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { GroupedList, GroupHeader } from "@/components/ui/group";
import { useReportList } from "@/lib/use-report-list";
import { openedLabel } from "@scoutable/shared/lib/scouting-reports-db";
import { reportStatusLabel } from "@scoutable/shared/lib/scouting-report-list";

const SHOWN = 3;

/** Home's shared reports: up to three live ones with their opens, nothing while none is shared. */
export function HomeReports() {
  const { state } = useReportList();
  if (state.kind !== "ready") return null;
  const live = state.items.filter((i) => i.status === "live");
  if (live.length === 0) return null;

  return (
    <section>
      <GroupHeader
        title={
          <>
            Shared reports
            <span className="ml-1.5 font-normal text-muted-foreground nums">{live.length}</span>
          </>
        }
        action={
          <Link to="/reports" className="text-sm text-primary hover:underline">
            View all
          </Link>
        }
      />
      <GroupedList>
        {live.slice(0, SHOWN).map((item) => (
          <Link
            key={item.playlistId}
            to="/playlists"
            state={{ restore: { playlistId: item.playlistId }, view: "report" }}
            className="group flex min-h-11 items-center gap-3 px-4 py-2 outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
          >
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-success" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
              <span className="block truncate text-subheadline nums text-muted-foreground">{reportStatusLabel(item)}</span>
            </span>
            <span className="shrink-0 text-subheadline nums text-muted-foreground">{openedLabel(item.opens)}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
          </Link>
        ))}
      </GroupedList>
    </section>
  );
}
