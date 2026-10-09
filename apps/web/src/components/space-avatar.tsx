import { User } from "lucide-react";
import { cn } from "@/lib/utils";

function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** A space's badge: a club's initials on the accent, or a person for a personal space. */
export function SpaceAvatar({ name, personal, className }: { name: string; personal: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
        personal ? "bg-fill-2 text-muted-foreground" : "bg-primary text-primary-foreground",
        className,
      )}
    >
      {personal ? <User className="size-4" /> : orgInitials(name)}
    </span>
  );
}
