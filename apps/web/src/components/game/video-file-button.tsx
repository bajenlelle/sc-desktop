"use client";

import { useRef } from "react";
import { GAME_VIDEO_SOURCE_EXTS } from "@scoutable/shared/lib/game-video-wire";
import { Button } from "@/components/ui/button";

/** What the file dialog offers: the types the converter takes. The function checks the name again. */
export const VIDEO_FILE_ACCEPT = ["video/*", ...GAME_VIDEO_SOURCE_EXTS.map((ext) => `.${ext}`)].join(",");

/**
 * A button that opens the file dialog for a game's video. The input itself
 * is hidden: the button carries the label and the styling.
 */
export function VideoFileButton({
  onFile,
  disabled,
  variant = "default",
  size = "default",
  className,
  children,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // The same file picked twice must fire again (a resume after a failed try).
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {children}
      </Button>
    </>
  );
}
