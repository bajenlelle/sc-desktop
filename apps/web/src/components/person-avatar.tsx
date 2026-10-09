"use client";

import { initials } from "@scoutable/shared/lib/playlist-feed";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** A person's picture, or their initials while there is none. */
export function PersonAvatar({ name, url, className }: { name?: string | null; url?: string | null; className?: string }) {
  return (
    <Avatar className={cn("size-6", className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary/15 text-caption font-semibold text-primary">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
