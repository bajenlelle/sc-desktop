import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_BUCKET, avatarPath, uploadAvatar, versionedAvatarUrl } from "../avatar";

const USER = "4a041034-2ab5-4396-9c31-70719e24aba1";
const PUBLIC = `https://example.supabase.co/storage/v1/object/public/avatars/${USER}/avatar`;

function mockClient(uploadError: { message: string } | null = null) {
  const upload = vi.fn().mockResolvedValue({ data: uploadError ? null : { path: avatarPath(USER) }, error: uploadError });
  const getPublicUrl = vi.fn().mockReturnValue({ data: { publicUrl: PUBLIC } });
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl });
  const client = { storage: { from } } as unknown as SupabaseClient;
  return { client, from, upload, getPublicUrl };
}

describe("avatarPath", () => {
  it("is one object per user, without an extension", () => {
    expect(avatarPath(USER)).toBe(`${USER}/avatar`);
  });
});

describe("versionedAvatarUrl", () => {
  it("adds the version", () => {
    expect(versionedAvatarUrl(PUBLIC, 1761120000000)).toBe(`${PUBLIC}?v=1761120000000`);
  });

  it("replaces any query already on the URL", () => {
    expect(versionedAvatarUrl(`${PUBLIC}?t=abc&download`, 7)).toBe(`${PUBLIC}?v=7`);
  });
});

describe("uploadAvatar", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "me.png", { type: "image/png" });

  it("overwrites the user's one object with the file's type and returns a versioned URL", async () => {
    const { client, from, upload } = mockClient();
    const url = await uploadAvatar(client, USER, file, 42);
    expect(from).toHaveBeenCalledWith(AVATAR_BUCKET);
    expect(upload).toHaveBeenCalledWith(`${USER}/avatar`, file, { upsert: true, contentType: "image/png" });
    expect(url).toBe(`${PUBLIC}?v=42`);
  });

  it("a new upload gets a new URL, so the old picture isn't served from cache", async () => {
    const { client } = mockClient();
    const first = await uploadAvatar(client, USER, file, 1);
    const second = await uploadAvatar(client, USER, file, 2);
    expect(first).not.toBe(second);
  });

  it("leaves the type to the client when the file has none", async () => {
    const { client, upload } = mockClient();
    await uploadAvatar(client, USER, new File([new Uint8Array([1])], "blob"), 1);
    expect(upload.mock.calls[0][2]).toEqual({ upsert: true, contentType: undefined });
  });

  it("throws Storage's message when the upload fails", async () => {
    const { client } = mockClient({ message: "Bucket not found" });
    await expect(uploadAvatar(client, USER, file, 1)).rejects.toThrow("Failed to upload avatar: Bucket not found");
  });
});
