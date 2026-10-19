import * as React from "react";
import { Maximize2, Minimize2, Pause, Play, RotateCcw, SkipBack, SkipForward, Square, Volume1, Volume2, VolumeX } from "lucide-react";
import { Slider as SliderPrimitive } from "radix-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPlayerVolume, togglePlayerMuted, usePlayerSound } from "@/lib/player-sound";
import { cn } from "@/lib/utils";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export interface TransportProps {
  paused: boolean;
  isQueueActive: boolean;
  canPrev: boolean;
  canNext: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onReplay: () => void;
  onStop: () => void;
}

/** A white-on-footage control that acts on the press and names its key in a tooltip. */
export function ControlButton({
  label,
  shortcut,
  onClick,
  disabled,
  size = "md",
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  size?: "md" | "lg";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          // Feedback on the press itself, before the browser's click fires.
          onPointerDown={(e) => {
            if (disabled || e.button !== 0) return;
            e.preventDefault();
            onClick();
          }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg text-white/85 outline-none transition-[background-color,transform,opacity] duration-100 hover:bg-white/10 hover:text-white active:scale-90 active:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-30 disabled:hover:bg-transparent disabled:active:scale-100",
            size === "lg" ? "size-10 [&_svg]:size-6" : "size-8 [&_svg]:size-[18px]",
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-1.5">
        {label}
        {shortcut && <Kbd className="h-4 min-w-4 border-white/20 bg-white/10 text-footnote text-white/80">{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Prev · Replay · Play/Pause · Next · Stop, with the speed menu and fullscreen. */
/** The speaker icon for a level: off, quiet or loud. */
export function SoundIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted) return <VolumeX />;
  return volume < 0.5 ? <Volume1 /> : <Volume2 />;
}

/**
 * The players' sound: the speaker mutes and unmutes (M), and a level slider
 * opens beside it on hover or focus, as in QuickTime. One setting for every
 * player (lib/player-sound.ts), so this reads and writes the store itself.
 */
export function VolumeControl() {
  const { volume, muted } = usePlayerSound();
  const level = muted ? 0 : volume;
  const percent = Math.round(level * 100);
  return (
    <div className="group/volume flex items-center">
      <ControlButton
        label={muted ? "Unmute" : "Mute"}
        shortcut="M"
        onClick={() => togglePlayerMuted()}
        className={muted ? "text-primary" : undefined}
      >
        <SoundIcon volume={volume} muted={muted} />
      </ControlButton>
      {/* Stays open while dragging: the thumb holds focus. */}
      <div className="w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-200 ease-out group-hover/volume:w-[72px] group-hover/volume:opacity-100 group-focus-within/volume:w-[72px] group-focus-within/volume:opacity-100 motion-reduce:transition-none">
        <SliderPrimitive.Root
          aria-label="Volume"
          value={[percent]}
          max={100}
          step={1}
          onValueChange={([v]) => setPlayerVolume(v / 100)}
          className="relative mx-2 flex h-8 w-14 touch-none select-none items-center"
        >
          <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-white/25">
            <SliderPrimitive.Range className="absolute h-full rounded-full bg-white" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label="Volume"
            aria-valuetext={`${percent}%`}
            className="block size-3 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.4)] outline-none transition-transform duration-100 active:scale-110 focus-visible:ring-2 focus-visible:ring-white/60"
          />
        </SliderPrimitive.Root>
      </div>
    </div>
  );
}

export function TransportBar({
  transport,
  speed,
  onSpeedChange,
  fullscreen,
  onToggleFullscreen,
  readout,
}: {
  transport: TransportProps;
  speed: number;
  onSpeedChange: (speed: number) => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** "0:04 / 0:13 · 3 of 48" */
  readout?: React.ReactNode;
}) {
  const { paused, isQueueActive, canPrev, canNext } = transport;
  return (
    <div className="flex items-center gap-0.5">
      <ControlButton label="Previous clip" shortcut="↑" onClick={transport.onPrev} disabled={!canPrev}>
        <SkipBack className="fill-current" />
      </ControlButton>
      <ControlButton label="Replay clip" shortcut="R" onClick={transport.onReplay} disabled={!isQueueActive}>
        <RotateCcw />
      </ControlButton>
      <ControlButton label={paused ? "Play" : "Pause"} shortcut="Space" onClick={transport.onTogglePlay} size="lg">
        {paused ? <Play className="translate-x-px fill-current" /> : <Pause className="fill-current" />}
      </ControlButton>
      <ControlButton label="Next clip" shortcut="↓" onClick={transport.onNext} disabled={!canNext}>
        <SkipForward className="fill-current" />
      </ControlButton>
      <ControlButton label="Stop" onClick={transport.onStop} disabled={!isQueueActive}>
        <Square className="size-3.5 fill-current" />
      </ControlButton>

      {readout && <span className="ml-2 truncate text-xs nums text-white/80">{readout}</span>}

      <div className="ml-auto flex items-center gap-0.5">
        <VolumeControl />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Playback speed"
              className={cn(
                "flex h-8 min-w-11 items-center justify-center rounded-lg px-2 text-xs font-semibold nums outline-none transition-[background-color,transform] duration-100 hover:bg-white/10 active:scale-95 active:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 data-[state=open]:bg-white/15",
                speed !== 1 ? "text-primary" : "text-white/85",
              )}
            >
              {speed}×
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-24">
            <DropdownMenuRadioGroup value={String(speed)} onValueChange={(v) => onSpeedChange(Number(v))}>
              {PLAYBACK_SPEEDS.map((s) => (
                <DropdownMenuRadioItem key={s} value={String(s)} className="nums">
                  {s}×
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {onToggleFullscreen && (
          <ControlButton label={fullscreen ? "Exit full screen" : "Full screen"} shortcut="F" onClick={onToggleFullscreen}>
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </ControlButton>
        )}
      </div>
    </div>
  );
}
