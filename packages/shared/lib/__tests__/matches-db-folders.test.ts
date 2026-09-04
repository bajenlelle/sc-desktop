import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFolder, listFolders } from "../matches-db";

interface FolderRow {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  parent_id: string | null;
  org_id: string | null;
  created_at: string;
}

function folderRow(partial: Partial<FolderRow>): FolderRow {
  return {
    id: "f1",
    user_id: "owner",
    name: "F",
    sort_order: 0,
    parent_id: null,
    org_id: null,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

/**
 * Double for the folder chains:
 *   from("playlist_folders").select("*")[.eq("org_id", …)|.or(…)].order("sort_order", …)
 *   from("playlist_folders").insert(…).select().single()
 */
function mockFolderClient(opts: { rows?: FolderRow[]; error?: { message: string } } = {}) {
  const calls: {
    tables: string[];
    eq: Array<[string, unknown]>;
    or: string[];
    order: Array<[string, unknown]>;
    inserted?: Record<string, unknown>;
  } = { tables: [], eq: [], or: [], order: [] };
  const listResult = { data: opts.error ? null : opts.rows ?? [], error: opts.error ?? null };
  const b: Record<string, unknown> = {
    select() { return b; },
    eq(col: string, val: unknown) { calls.eq.push([col, val]); return b; },
    or(filter: string) { calls.or.push(filter); return b; },
    order(col: string, o: unknown) { calls.order.push([col, o]); return b; },
    insert(payload: Record<string, unknown>) { calls.inserted = payload; return b; },
    single: async () => ({
      data: folderRow({
        id: "new",
        name: (calls.inserted?.name as string) ?? "N",
        parent_id: (calls.inserted?.parent_id as string | null) ?? null,
        org_id: (calls.inserted?.org_id as string | null) ?? null,
      }),
      error: null,
    }),
    then: (r: (x: typeof listResult) => unknown) => Promise.resolve(listResult).then(r),
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "owner" } } }, error: null }),
      getUser: async () => ({ data: { user: { id: "owner" } }, error: null }),
    },
    from(table: string) { calls.tables.push(table); return b; },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("listFolders org scoping", () => {
  it("filters by org_id when an orgId is given", async () => {
    const { client, calls } = mockFolderClient({ rows: [folderRow({ org_id: "orgA" })] });
    await listFolders(client, "orgA");
    expect(calls.tables).toEqual(["playlist_folders"]);
    expect(calls.eq).toEqual([["org_id", "orgA"]]);
    expect(calls.or).toEqual([]);
  });

  it("includes org_id NULL rows via .or when includeUnscoped is set (personal space)", async () => {
    const { client, calls } = mockFolderClient();
    await listFolders(client, "orgP", { includeUnscoped: true });
    expect(calls.or).toEqual(["org_id.eq.orgP,org_id.is.null"]);
    expect(calls.eq).toEqual([]);
  });

  it("stays unfiltered (cross-org) when orgId is omitted", async () => {
    const { client, calls } = mockFolderClient();
    await listFolders(client);
    expect(calls.eq).toEqual([]);
    expect(calls.or).toEqual([]);
  });

  it("still orders by sort_order ascending", async () => {
    const { client, calls } = mockFolderClient();
    await listFolders(client, "orgA");
    expect(calls.order).toEqual([["sort_order", { ascending: true }]]);
  });

  it("maps org_id and parent_id onto the domain object", async () => {
    const { client } = mockFolderClient({
      rows: [folderRow({ org_id: "orgA", parent_id: "root", sort_order: 3 })],
    });
    const [f] = await listFolders(client, "orgA");
    expect(f).toEqual({ id: "f1", name: "F", sortOrder: 3, parentId: "root", orgId: "orgA" });
  });

  it("maps org_id NULL to an undefined orgId (legacy row)", async () => {
    const { client } = mockFolderClient({ rows: [folderRow({ org_id: null })] });
    const [f] = await listFolders(client);
    expect(f.orgId).toBeUndefined();
    expect(f.parentId).toBeUndefined();
  });

  it("degrades to [] when the query fails", async () => {
    const { client } = mockFolderClient({ error: { message: "boom" } });
    await expect(listFolders(client, "orgA")).resolves.toEqual([]);
  });
});

describe("createFolder org scoping", () => {
  it("writes the org_id it was given alongside the owner", async () => {
    const { client, calls } = mockFolderClient();
    const created = await createFolder(client, "Name", "parent1", "orgA");
    expect(calls.inserted).toEqual({
      user_id: "owner",
      name: "Name",
      sort_order: 0,
      parent_id: "parent1",
      org_id: "orgA",
    });
    expect(created.orgId).toBe("orgA");
    expect(created.parentId).toBe("parent1");
  });

  it("writes org_id NULL when no org is given (legacy caller)", async () => {
    const { client, calls } = mockFolderClient();
    const created = await createFolder(client, "Name");
    expect(calls.inserted?.org_id).toBeNull();
    expect(calls.inserted?.parent_id).toBeNull();
    expect(created.orgId).toBeUndefined();
  });
});
