import * as React from "react";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

/**
 * The signed-out screens and Join a club: a narrow column on the page's
 * background under the app's mark, the way a Mac app asks you to sign in.
 * No card around it: the page is the surface. Safe-area padding keeps it
 * clear of the notch and the home indicator on phones.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 pt-[calc(3.5rem+var(--safe-top))] pb-[calc(3.5rem+var(--safe-bottom))]">
      <div className="w-full max-w-[340px]">
        <LogoMark className="mx-auto mb-5 size-14 rounded-[13px] shadow-sm ring-1 ring-black/5" />
        {children}
      </div>
    </div>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-6 text-center">
      <h1 className="text-title-1 text-foreground">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** Fields stacked in one rounded box with hairlines between them. */
export function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("divide-y divide-separator overflow-hidden rounded-window bg-card ring-1 ring-separator", className)}
      {...props}
    />
  );
}

/** A borderless field for a FieldGroup; the focus ring sits inside the box. */
export function GroupField({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "block h-10 w-full min-w-0 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground pointer-coarse:h-11",
        "selection:bg-selection selection:text-selection-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-selection",
        "aria-invalid:ring-2 aria-invalid:ring-inset aria-invalid:ring-destructive/50",
        className,
      )}
      {...props}
    />
  );
}

/** An inline error under a form: announced, never a box. */
export function AuthError({ message }: { message: string | null }) {
  return (
    <p role="alert" aria-live="polite" className={cn("px-1 text-callout text-destructive", !message && "sr-only")}>
      {message}
    </p>
  );
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-subheadline text-muted-foreground" aria-hidden>
      <span className="h-px flex-1 bg-separator" />
      or
      <span className="h-px flex-1 bg-separator" />
    </div>
  );
}
