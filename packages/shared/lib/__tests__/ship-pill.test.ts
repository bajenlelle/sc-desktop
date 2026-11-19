import { describe, expect, it } from "vitest";
import { shipPill } from "../ship-pill";
import type { ShipStatus } from "../ship-scheduler";

const held = (id: string, name: string, count: number) => ({ playlist: { id, name }, count });
const statuses = (entries: [string, ShipStatus][]) => new Map(entries);
const waiting: ShipStatus = { phase: "waiting", done: 0, total: 0 };
const failed: ShipStatus = { phase: "failed", done: 0, total: 0 };
const sending = (done: number, total: number): ShipStatus => ({ phase: "sending", done, total });

describe("shipPill", () => {
  it("no held clips → null", () => {
    expect(shipPill([], statuses([]), "A")).toBeNull();
  });

  it("waiting, in the target", () => {
    expect(shipPill([held("A", "Defence", 3)], statuses([["A", waiting]]), "A")).toEqual({ kind: "waiting", playlistId: "A", label: "3 clips waiting" });
  });

  it("waiting, in another playlist", () => {
    expect(shipPill([held("A", "Defence", 1)], statuses([["A", waiting]]), "B")).toEqual({ kind: "waiting", playlistId: "A", label: "1 clip waiting in Defence" });
  });

  it("sending, in the target", () => {
    expect(shipPill([held("A", "Defence", 3)], statuses([["A", sending(2, 3)]]), "A")).toEqual({ kind: "sending", playlistId: "A", label: "Sending 2 of 3" });
  });

  it("sending, in another playlist", () => {
    expect(shipPill([held("A", "Defence", 3)], statuses([["A", sending(2, 3)]]), "B")).toEqual({ kind: "sending", playlistId: "A", label: "Sending to Defence · 2 of 3" });
  });

  it("sending before the first progress counts the held clips", () => {
    expect(shipPill([held("A", "Defence", 3)], statuses([["A", sending(0, 0)]]), "A")?.label).toBe("Sending 0 of 3");
  });

  it("failed is unsent", () => {
    expect(shipPill([held("A", "Defence", 3)], statuses([["A", failed]]), "A")).toEqual({ kind: "unsent", playlistId: "A", label: "Send 3 clips" });
  });

  it("no status (left from before) is unsent, named when not the target", () => {
    expect(shipPill([held("A", "Defence", 1)], statuses([]), "B")).toEqual({ kind: "unsent", playlistId: "A", label: "Send 1 clip to Defence" });
  });

  it("several playlists: a total, the worst phase", () => {
    const pill = shipPill([held("A", "Defence", 3), held("B", "Offence", 2)], statuses([["A", waiting]]), "A");
    expect(pill).toEqual({ kind: "several", label: "5 clips in 2 playlists", worst: "unsent" });
  });

  it("several: sending outranks unsent and waiting", () => {
    const pill = shipPill([held("A", "Defence", 3), held("B", "Offence", 2)], statuses([["A", waiting], ["B", sending(1, 2)]]), null);
    expect(pill?.kind === "several" && pill.worst).toBe("sending");
  });

  it("several: all waiting is waiting", () => {
    const pill = shipPill([held("A", "Defence", 3), held("B", "Offence", 2)], statuses([["A", waiting], ["B", waiting]]), null);
    expect(pill?.kind === "several" && pill.worst).toBe("waiting");
  });

  it("the target's name is never shown", () => {
    for (const s of [waiting, failed, sending(1, 2)]) {
      expect(shipPill([held("A", "Defence", 2)], statuses([["A", s]]), "A")?.label).not.toContain("Defence");
    }
  });
});
