import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A whole-view state: something is loading, blocked or broken, and here is
 * what to do about it. Fills whatever column it is put in (the content column
 * beside the sidebar, or the bare window), centred, one action first.
 */
export function StatusScreen({
  icon,
  title,
  body,
  actions,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  actions?: React.ReactNode;
  /** Extra content between the text and the actions, e.g. a list of devices. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-[24rem] w-full items-center justify-center bg-background px-6 py-12", className)}>
      <div className="flex w-full max-w-md flex-col items-center text-center">
        {icon && (
          <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-fill-1 text-muted-foreground [&_svg]:size-6">
            {icon}
          </span>
        )}
        <h1 className="text-title-2 text-foreground">{title}</h1>
        {body && <div className="mt-1.5 text-sm text-muted-foreground">{body}</div>}
        {children && <div className="mt-5 w-full text-left">{children}</div>}
        {actions && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
