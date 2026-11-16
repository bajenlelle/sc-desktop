import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listLabels, setLabelHotkey } from "../labels-db";

const row = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  user_id: "u",
  org_id: "o",
  name: "Drive",
  color: "cyan",
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

/** A client whose reads of `labels` answer in turn, recording the columns each one asked for. */
function reads(...results: Array<{ data: unknown; error: unknown }>) {
  const asked: string[] = [];
  const client = {
    from: () => ({
      select: (columns: string) => {
        asked.push(columns);
        const result = results[asked.length - 1];
        return { eq: () => ({ order: () => Promise.resolve(result) }) };
      },
    }),
  } as unknown as SupabaseClient;
  return { client, asked };
}

describe("listLabels", () => {
  it("reads each label with its key", async () => {
    const { client, asked } = reads({ data: [row({ hotkey: 3 }), row({ id: "l2", name: "Iso", hotkey: null })], error: null });
    const labels = await listLabels(client, "o");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("hotkey");
    expect(labels.map((l) => [l.name, l.hotkey])).toEqual([["Drive", 3], ["Iso", null]]);
  });

  it("still lists the labels, without keys, from a database that has no key column yet", async () => {
    const { client, asked } = reads(
      { data: null, error: { code: "42703", message: "column labels.hotkey does not exist" } },
      { data: [row()], error: null },
    );
    const labels = await listLabels(client, "o");
    expect(asked).toHaveLength(2);
    expect(asked[1]).not.toContain("hotkey");
    expect(labels).toEqual([{ id: "l1", userId: "u", orgId: "o", name: "Drive", color: "cyan", createdAt: "2026-01-01T00:00:00Z", hotkey: null }]);
  });

  it("reads nothing more after any other failure", async () => {
    const { client, asked } = reads({ data: null, error: { code: "PGRST301", message: "jwt expired" } });
    expect(await listLabels(client, "o")).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("takes a key it can't be as no key", async () => {
    const { client } = reads({ data: [row({ hotkey: 12 }), row({ id: "l2", hotkey: 0 })], error: null });
    expect((await listLabels(client, "o")).map((l) => l.hotkey)).toEqual([null, null]);
  });
});

describe("setLabelHotkey", () => {
  it("sets and clears the key through set_label_hotkey", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = { rpc } as unknown as SupabaseClient;
    await setLabelHotkey(client, "l1", 4);
    await setLabelHotkey(client, "l1", null);
    expect(rpc.mock.calls).toEqual([
      ["set_label_hotkey", { p_label_id: "l1", p_hotkey: 4 }],
      ["set_label_hotkey", { p_label_id: "l1", p_hotkey: null }],
    ]);
  });

  it("throws when the write is refused", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { message: "not_owner" } }) } as unknown as SupabaseClient;
    await expect(setLabelHotkey(client, "l1", 1)).rejects.toThrow(/not_owner/);
  });
});
