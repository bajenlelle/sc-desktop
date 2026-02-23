import { Play } from "lucide-react";

export function VideoPlaceholder() {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-900">
      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Play button */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm transition-colors hover:bg-white/20">
          <Play className="h-7 w-7 text-white" fill="white" />
        </div>
        <p className="text-sm font-medium text-slate-400">
          Match video will appear here
        </p>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 bg-gradient-to-t from-black/60 to-transparent px-4 py-3">
        <div className="h-1 flex-1 rounded-full bg-white/20">
          <div className="h-1 w-1/3 rounded-full bg-indigo-500" />
        </div>
        <span className="text-xs font-medium text-white/70">00:00 / 40:00</span>
      </div>
    </div>
  );
}
