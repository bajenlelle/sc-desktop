import { useEffect, useState } from "react";
import type { CardAspect } from "@scoutable/shared/lib/card-layout";
import { cardContent, fallbackText } from "@scoutable/shared/lib/stats-card";
import { cardObjectUrl, type CardSource } from "@/lib/card-painter";
import { cn } from "@/lib/utils";

/**
 * A card exactly as it will export: painted at its export size by the same
 * painter and shown fitted to its box (a vertical card pillarboxed on a
 * widescreen stage). An <img>, not a live canvas, so nothing canvas-backed
 * sits over the video.
 */
export function CardImage({
  source,
  aspect,
  className,
}: {
  source: CardSource;
  aspect: CardAspect;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  // Repaint only when what the card draws changes.
  const drawn = JSON.stringify([aspect, source.card ? cardContent(source.card) : source.text]);

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    cardObjectUrl(source, aspect)
      .then((u) => {
        if (cancelled) URL.revokeObjectURL(u);
        else {
          made = u;
          setUrl(u);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [drawn]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = source.card ? fallbackText(source.card) : source.text;
  if (!url) return <div role="img" aria-label={label} className={cn("bg-black", className)} />;
  return <img src={url} alt={label} draggable={false} className={cn("object-contain select-none", className)} />;
}
