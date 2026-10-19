/**
 * The players' sound: one volume and one mute for every player in the app,
 * remembered on this computer. A tiny external store, like the sidebar's, so
 * the editor, the Add clips sheet open over it, the watch view, the sync
 * pickers and the key handlers all agree without a provider.
 *
 * The level is never stored as zero: dragging the slider to zero mutes
 * instead, so unmuting brings the last level back. Exports ignore all of
 * this and always carry full sound.
 */
import { useSyncExternalStore } from "react";

const VOLUME_KEY = "scoutable_player_volume";
const MUTED_KEY = "scoutable_player_muted";

export interface PlayerSound {
  /** 0–1, above zero. */
  volume: number;
  muted: boolean;
}

let sound: PlayerSound = (() => {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    const volume = stored === null ? 1 : Number(stored);
    return {
      volume: Number.isFinite(volume) && volume > 0 && volume <= 1 ? volume : 1,
      muted: localStorage.getItem(MUTED_KEY) === "1",
    };
  } catch {
    return { volume: 1, muted: false };
  }
})();

const listeners = new Set<() => void>();
const announced = new Set<(sound: PlayerSound) => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function update(next: PlayerSound) {
  if (next.volume === sound.volume && next.muted === sound.muted) return;
  sound = next;
  try {
    localStorage.setItem(VOLUME_KEY, String(next.volume));
    localStorage.setItem(MUTED_KEY, next.muted ? "1" : "0");
  } catch {
    /* private mode or quota: the session still works */
  }
  for (const listener of listeners) listener();
}

export function usePlayerSound(): PlayerSound {
  return useSyncExternalStore(subscribe, () => sound, () => sound);
}

/** From the slider: zero mutes and keeps the level; anything above sets it and unmutes. */
export function setPlayerVolume(level: number) {
  const v = Math.min(1, Math.max(0, level));
  update(v === 0 ? { ...sound, muted: true } : { volume: v, muted: false });
}

/**
 * Mute or unmute. `announce` is for the M key: players then show the change
 * on the footage, since their controls may be hidden. The button needs no
 * announcement, as its own icon changes.
 */
export function togglePlayerMuted(opts: { announce?: boolean } = {}) {
  update({ ...sound, muted: !sound.muted });
  if (opts.announce) for (const listener of announced) listener(sound);
}

/** Calls back on every announced change (the M key), for the on-footage glyph. */
export function onSoundAnnounced(listener: (sound: PlayerSound) => void): () => void {
  announced.add(listener);
  return () => {
    announced.delete(listener);
  };
}
