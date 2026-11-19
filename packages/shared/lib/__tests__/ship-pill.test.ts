import { describe, expect, it } from "vitest";
import { shipIndicator } from "../ship-pill";
import type { ShipStatus } from "../ship-scheduler";

const held = (id: string, name: string, count: number) => ({ playlist: { id, name }, count });
const statuses = (entries: [string, ShipStatus][]) => new Map(entries);
const waiting: ShipStatus = { phase: "waiting", done: 0, total: 0 };
const failed: ShipStatus = { phase: "failed", done: 0, total: 0 };
const sending = (done: number, total: number): ShipStatus => ({ phase: "sending", done, total });

describe("shipIndicator", () => {
  it("nothing held: nothing to show", () => {
    expect(shipIndicator([], statuses([]), "A")).toEqual({ sending: null, unsent: null });
  });

  it("waiting clips show nothing: they go by themselves", () => {
    expect(shipIndicator([held("A", "Defence", 3)], statuses([["A", waiting]]), "A")).toEqual({ sending: null, unsent: null });
  });

  it("sending the target", () => {
    expect(shipIndicator([held("A", "Defence", 3)], statuses([["A", sending(2, 3)]]), "A").sending).toEqual({
      playlistId: "A",
      onTarget: true,
      done: 2,
      total: 3,
      label: "Sending 2 of 3 clips to players",
    });
  });

  it("sending another playlist names it", () => {
    expect(shipIndicator([held("A", "Defence", 1)], statuses([["A", sending(0, 1)]]), "B").sending).toEqual({
      playlistId: "A",
      onTarget: false,
      done: 0,
      total: 1,
      label: "Sending 0 of 1 clip in Defence to players",
    });
  });

  it("before the first progress, the total is the held count", () => {
    expect(shipIndicator([held("A", "Defence", 3)], statuses([["A", sending(0, 0)]]), "A").sending?.total).toBe(3);
  });

  it("several sending: the target's is shown", () => {
    const ind = shipIndicator([held("B", "Offence", 2), held("A", "Defence", 3)], statuses([["A", sending(1, 3)], ["B", sending(1, 2)]]), "A");
    expect(ind.sending?.playlistId).toBe("A");
  });

  it("failed and left-over clips are not sent, counted over playlists", () => {
    const ind = shipIndicator([held("A", "Defence", 3), held("B", "Offence", 2), held("C", "Press", 4)], statuses([["A", failed], ["C", waiting]]), "A");
    expect(ind.unsent).toEqual({
      count: 5,
      label: "5 not sent",
      playlists: [
        { id: "A", name: "Defence", count: 3 },
        { id: "B", name: "Offence", count: 2 },
      ],
    });
  });

  it("one playlist sending while another wasn't sent shows both", () => {
    const ind = shipIndicator([held("A", "Defence", 3), held("B", "Offence", 1)], statuses([["A", sending(1, 3)]]), "A");
    expect(ind.sending?.playlistId).toBe("A");
    expect(ind.unsent?.label).toBe("1 not sent");
  });
});
