import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FULL_NAME_MAX, normalizeFullName } from "../profile-name";
import { updateMyFullName } from "../profile-db";

describe("normalizeFullName", () => {
  it("trims and folds runs of spaces into one", () => {
    expect(normalizeFullName("  Karin   Ahl \n")).toBe("Karin Ahl");
  });

  it("is null for an empty or blank name", () => {
    expect(normalizeFullName("")).toBeNull();
    expect(normalizeFullName("   \t ")).toBeNull();
  });

  it("cuts a name at the limit, without a trailing space", () => {
    const long = `${"a".repeat(FULL_NAME_MAX - 1)} bcd`;
    const out = normalizeFullName(long);
    expect(out).toBe("a".repeat(FULL_NAME_MAX - 1));
    expect(out!.length).toBeLessThanOrEqual(FULL_NAME_MAX);
  });

  it("keeps letters outside ASCII", () => {
    expect(normalizeFullName("Åsa Öberg-Ekström")).toBe("Åsa Öberg-Ekström");
  });
});

/** A double for `from(table).update(row).eq(col, value)`. */
function mockUpdateClient(error: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as SupabaseClient, from, update, eq };
}

describe("updateMyFullName", () => {
  it("writes the name to the caller's own profile row", async () => {
    const { client, from, update, eq } = mockUpdateClient();
    await updateMyFullName(client, "u1", "Karin Ahl");
    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ full_name: "Karin Ahl" });
    expect(eq).toHaveBeenCalledWith("id", "u1");
  });

  it("throws when the update fails", async () => {
    const { client } = mockUpdateClient({ message: "permission denied" });
    await expect(updateMyFullName(client, "u1", "Karin Ahl")).rejects.toThrow("permission denied");
  });
});
