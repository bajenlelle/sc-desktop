import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const VIDEO_EXTS = ["mp4", "mov", "avi", "mkv", "webm", "m4v"];

export interface DropZoneCallbacks {
  onEnter: () => void;
  onLeave: () => void;
  onDrop: (path: string) => void;
  isOver: (pos: { x: number; y: number }) => boolean;
}

let initialized = false;
let zone: DropZoneCallbacks | null = null;

export function initDragDrop(): void {
  if (initialized) return;
  initialized = true;

  getCurrentWebviewWindow().onDragDropEvent((event) => {
    if (!zone) return;
    const { type } = event.payload;
    if (type === "enter" || type === "over") {
      if (zone.isOver(event.payload.position)) zone.onEnter();
      else zone.onLeave();
    } else if (type === "leave") {
      zone.onLeave();
    } else if (type === "drop") {
      if (zone.isOver(event.payload.position)) {
        const dropped = event.payload.paths.find((p) =>
          VIDEO_EXTS.some((ext) => p.toLowerCase().endsWith(`.${ext}`))
        );
        if (dropped) zone.onDrop(dropped);
      }
    }
  });
  // No unlisten stored — this listener lives for the app's lifetime.
}

export function registerDropZone(callbacks: DropZoneCallbacks): void {
  zone = callbacks;
}

export function unregisterDropZone(): void {
  zone = null;
}
