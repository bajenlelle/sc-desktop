import type { ReactNode } from "react";

/**
 * The empty state used across list surfaces: a quiet icon, a title, one
 * line of body, and the next step. Every empty state carries an action,
 * never just a message.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center select-none">
      {icon && (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-fill-1 text-muted-foreground [&_svg]:size-6">
          {icon}
        </div>
      )}
      <p className="text-title-3 text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
