import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUserId } from "../current-user";

/** Minimal stub exposing only auth.getSession, which is all the helper reads. */
const clientWith = (result: unknown) =>
  ({ auth: { getSession: vi.fn().mockResolvedValue(result) } }) as unknown as SupabaseClient;

describe("currentUserId", () => {
  it("returns the id from an active session", async () => {
    const supabase = clientWith({ data: { session: { user: { id: "u1" } } }, error: null });
    await expect(currentUserId(supabase)).resolves.toBe("u1");
  });

  it("returns null when there is no session", async () => {
    const supabase = clientWith({ data: { session: null }, error: null });
    await expect(currentUserId(supabase)).resolves.toBeNull();
  });

  it("returns null when getSession reports an error", async () => {
    const supabase = clientWith({ data: { session: null }, error: new Error("boom") });
    await expect(currentUserId(supabase)).resolves.toBeNull();
  });

  it("returns null when the session carries no user", async () => {
    const supabase = clientWith({ data: { session: {} }, error: null });
    await expect(currentUserId(supabase)).resolves.toBeNull();
  });

  it("never calls getUser — the round trip this helper exists to avoid", async () => {
    const getUser = vi.fn();
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null }), getUser },
    } as unknown as SupabaseClient;
    await currentUserId(supabase);
    expect(getUser).not.toHaveBeenCalled();
  });
});
