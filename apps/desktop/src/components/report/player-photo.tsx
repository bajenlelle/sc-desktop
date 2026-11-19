import { useState, type ReactNode } from "react";
import { MEDIA_BASE, playerPhotoSources } from "@scoutable/shared/lib/player-photos";
import { cn } from "@/lib/utils";

/**
 * A player's roster photo, round, at `px` CSS pixels, with their number as a
 * small badge when `badge` is given. Without a photo (or when it fails to
 * load) it shows `fallback`, so callers keep their own placeholder.
 */
export function PlayerPhoto({
  photoKey,
  px,
  fallback,
  badge,
  className,
}: {
  photoKey: string | undefined;
  px: number;
  fallback: ReactNode;
  badge?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const sources = playerPhotoSources(MEDIA_BASE, photoKey, px);
  if (!sources || failed === photoKey) return <>{fallback}</>;
  const img = (
    <img
      src={sources.src}
      srcSet={sources.srcSet}
      alt=""
      aria-hidden
      draggable={false}
      loading="lazy"
      decoding="async"
      width={px}
      height={px}
      onError={() => setFailed(photoKey ?? null)}
      style={{ width: px, height: px }}
      className={cn("shrink-0 rounded-full bg-fill-1 object-cover object-top ring-1 ring-foreground/10", !badge && className)}
    />
  );
  if (!badge) return img;
  return (
    <span aria-hidden className={cn("relative shrink-0", className)} style={{ width: px, height: px }}>
      {img}
      <span className="absolute -bottom-0.5 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-background px-1 text-caption font-semibold text-foreground ring-1 ring-foreground/30 nums">
        {badge}
      </span>
    </span>
  );
}
