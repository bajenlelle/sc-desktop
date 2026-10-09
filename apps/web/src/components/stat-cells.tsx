import { cn } from "@/lib/utils";
import { GroupedList } from "@/components/ui/group";

export interface StatCell {
  value: number;
  label: string;
  /** Tints the figure as a warning (someone is behind). */
  warn?: boolean;
  /** Makes the cell a button, e.g. to filter by what it counts. */
  onClick?: () => void;
  title?: string;
}

/**
 * A row of figures in one group, separated by hairlines: the summary at the
 * top of Home's engagement section and of the Shared by me dashboard.
 */
export function StatCells({ cells, className }: { cells: StatCell[]; className?: string }) {
  return (
    <GroupedList className={cn("divide-y-0", className)}>
      <div className="grid divide-x divide-separator" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
        {cells.map((c) => {
          const body = (
            <>
              <div className={cn("text-title-2 nums", c.warn ? "text-warning" : "text-foreground")}>{c.value}</div>
              {/* Wraps rather than truncates: three cells share a phone's width. */}
              <div className="text-callout text-muted-foreground">{c.label}</div>
            </>
          );
          return c.onClick ? (
            <button
              key={c.label}
              type="button"
              onClick={c.onClick}
              title={c.title}
              className="px-4 py-3 text-left outline-none transition-colors duration-100 hover:bg-fill-1 active:bg-fill-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection"
            >
              {body}
            </button>
          ) : (
            <div key={c.label} className="px-4 py-3">
              {body}
            </div>
          );
        })}
      </div>
    </GroupedList>
  );
}
