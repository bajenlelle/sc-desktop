/**
 * What the game view shows about clips players don't have yet, and how
 * loud. Clips waiting for the quiet spell show nothing: they go by
 * themselves. A send in progress is a small ring on the playlist control,
 * its words in a tooltip, naming a playlist other than the target. Only
 * clips that didn't go (a failure, or left from an earlier visit) ask for
 * the coach: "n not sent". Pure; `collect-control.tsx` draws it.
 */
import type { ShipStatus } from "./ship-scheduler";

export type ShipIndicator = {
  sending: { playlistId: string; onTarget: boolean; done: number; total: number; label: string } | null;
  unsent: { count: number; label: string; playlists: { id: string; name: string; count: number }[] } | null;
};

const clips = (n: number) => `${n} ${n === 1 ? "clip" : "clips"}`;

export function shipIndicator(
  held: readonly { playlist: { id: string; name: string }; count: number }[],
  statuses: ReadonlyMap<string, ShipStatus>,
  targetId: string | null,
): ShipIndicator {
  const phase = (id: string) => statuses.get(id)?.phase;
  const sendingAll = held.filter((h) => phase(h.playlist.id) === "sending");
  const shown = sendingAll.find((h) => h.playlist.id === targetId) ?? sendingAll[0];
  let sending: ShipIndicator["sending"] = null;
  if (shown) {
    const s = statuses.get(shown.playlist.id)!;
    const total = s.total > 0 ? s.total : shown.count;
    const onTarget = shown.playlist.id === targetId;
    const what = onTarget ? clips(total) : `${clips(total)} in ${shown.playlist.name}`;
    sending = { playlistId: shown.playlist.id, onTarget, done: s.done, total, label: `Sending ${s.done} of ${what} to players` };
  }
  // No status, or a failed one: nothing will send these by itself.
  const left = held.filter((h) => phase(h.playlist.id) === undefined || phase(h.playlist.id) === "failed");
  const count = left.reduce((sum, h) => sum + h.count, 0);
  const unsent = left.length === 0
    ? null
    : { count, label: `${count} not sent`, playlists: left.map((h) => ({ id: h.playlist.id, name: h.playlist.name, count: h.count })) };
  return { sending, unsent };
}
