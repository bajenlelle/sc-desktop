"use client";

import { useEffect, useState } from "react";
import type { CardAspect } from "@scoutable/shared/lib/card-layout";
import { cardContent, fallbackText } from "@scoutable/shared/lib/stats-card";
import { cardObjectUrl, type CardSource } from "@/lib/card-painter";
import { cn } from "@/lib/utils";

/**
 * A card exactly as it exports: painted at its export size by the shared
 * painter and shown fitted to its box (a vertical card pillarboxed in a
 * widescreen box). An <img>, not a live canvas, so nothing canvas-backed sits
 * over the video. The desktop's CardImage, ported.
 *
 * Black while the font loads; if it can't be painted (the font didn't load),
 * the card's readable line instead, as builds without the painter show it.
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
  const [failedFor, setFailedFor] = useState<string | null>(null);
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
      .catch(() => {
        if (!cancelled) setFailedFor(drawn);
      });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [drawn]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = source.card ? fallbackText(source.card) : source.text;
  if (failedFor === drawn) {
    return (
      <div
        role="img"
        aria-label={label}
        className={cn("flex items-center justify-center bg-black px-8 text-center text-xl font-semibold text-white sm:text-3xl", className)}
      >
        <span aria-hidden>{label}</span>
      </div>
    );
  }
  if (!url) return <div role="img" aria-label={label} className={cn("bg-black", className)} />;
  // A blob: URL painted here; next/image has nothing to optimise.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={label} draggable={false} className={cn("object-contain select-none", className)} />;
}
