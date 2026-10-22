/**
 * Profile pictures in the public `avatars` bucket (migration
 * 20261018210000_avatars_bucket.sql). Isomorphic: callers pass their
 * platform Supabase client.
 *
 * One object per user at `<user id>/avatar`, overwritten on every upload, so
 * a new format never leaves the old file behind. Storage serves it with an
 * hour's cache, so the saved URL carries a version: a new picture shows at
 * once instead of up to an hour later.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const AVATAR_BUCKET = "avatars";

export function avatarPath(userId: string): string {
  return `${userId}/avatar`;
}

/** The public URL as saved on the profile: any query replaced by `?v=<version>`. */
export function versionedAvatarUrl(publicUrl: string, version: number): string {
  return `${publicUrl.split("?")[0]}?v=${version}`;
}

/** Uploads (or replaces) the user's picture and returns the URL to save on their profile. */
export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  now: number = Date.now(),
): Promise<string> {
  const path = avatarPath(userId);
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(`Failed to upload avatar: ${error.message}`);
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  return versionedAvatarUrl(data.publicUrl, now);
}
