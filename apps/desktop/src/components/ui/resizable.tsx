import { GripVertical } from "lucide-react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import type { GroupProps } from "react-resizable-panels";
import { cn } from "@/lib/utils";

type ResizablePanelGroupProps = Omit<GroupProps, "orientation"> & {
  direction?: "horizontal" | "vertical";
  autoSaveId?: string;
};

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  autoSaveId,
  ...props
}: ResizablePanelGroupProps) {
  const layout = useDefaultLayout(
    autoSaveId ? { id: autoSaveId, storage: sessionStorage } : ({ id: "__noop__" } as { id: string })
  );

  return (
    <Group
      orientation={direction}
      className={cn(
        "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
        className
      )}
      {...(autoSaveId ? { defaultLayout: layout.defaultLayout, onLayoutChanged: layout.onLayoutChanged } : {})}
      {...props}
    />
  );
}

const ResizablePanel = Panel;

/**
 * The line between two panels, and the way to drag them: the library gives it a hit area wider than the
 * line, the resize cursor and a double-click back to the panels' first sizes. The line thickens and
 * darkens under the pointer and while it is dragged, so it can be found without knowing it is there.
 */
const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}) => (
  <Separator
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-[3px] after:-translate-x-1/2 after:rounded-full after:transition-colors after:duration-150 motion-reduce:after:transition-none data-[separator=hover]:after:bg-separator-strong data-[separator=active]:after:bg-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-[3px] aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:-translate-y-1/2 aria-[orientation=horizontal]:after:translate-x-0 [&[aria-orientation=horizontal]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
