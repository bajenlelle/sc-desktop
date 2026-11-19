/**
 * What the game view's control says about clips players don't have yet, in
 * place of a Send button: they wait for a quiet spell, are being sent, or
 * didn't go (a failure, or left from an earlier visit) and wait for a press.
 * A playlist other than the target is named, so "Adding to B" beside it is
 * never read as sending to B. Pure; `collect-control.tsx` draws it.
 */
import type { ShipStatus } from "./ship-scheduler";

export type ShipPillPhase = "waiting" | "sending" | "unsent";

export type ShipPill =
  | { kind: ShipPillPhase; playlistId: string; label: string }
  | { kind: "several"; label: string; worst: ShipPillPhase }
  | null;

const clips = (n: number) => `${n} ${n === 1 ? "clip" : "clips"}`;

/** A playlist's phase: no status means nothing will send it by itself. */
export function shipPhase(status: ShipStatus | undefined): ShipPillPhase {
  if (status?.phase === "sending") return "sending";
  if (status?.phase === "waiting") return "waiting";
  return "unsent";
}

const RANK: Record<ShipPillPhase, number> = { sending: 2, unsent: 1, waiting: 0 };

export function shipPill(
  held: readonly { playlist: { id: string; name: string }; count: number }[],
  statuses: ReadonlyMap<string, ShipStatus>,
  targetId: string | null,
): ShipPill {
  if (held.length === 0) return null;
  if (held.length > 1) {
    const total = held.reduce((sum, h) => sum + h.count, 0);
    const worst = held
      .map((h) => shipPhase(statuses.get(h.playlist.id)))
      .reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
    return { kind: "several", label: `${clips(total)} in ${held.length} playlists`, worst };
  }
  const [{ playlist, count }] = held;
  const status = statuses.get(playlist.id);
  const other = playlist.id !== targetId;
  const phase = shipPhase(status);
  if (phase === "sending") {
    const total = status && status.total > 0 ? status.total : count;
    const done = status?.done ?? 0;
    return { kind: "sending", playlistId: playlist.id, label: other ? `Sending to ${playlist.name} · ${done} of ${total}` : `Sending ${done} of ${total}` };
  }
  if (phase === "waiting") {
    return { kind: "waiting", playlistId: playlist.id, label: other ? `${clips(count)} waiting in ${playlist.name}` : `${clips(count)} waiting` };
  }
  return { kind: "unsent", playlistId: playlist.id, label: other ? `Send ${clips(count)} to ${playlist.name}` : `Send ${clips(count)}` };
}
