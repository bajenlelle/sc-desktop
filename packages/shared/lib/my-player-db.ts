/**
 * Database operations for the `my_players` table (20261127100000): which roster player the signed-in account is,
 * so the Highlights page knows the player's own plays in every game. One row per account and source (Genius).
 *
 * Each function accepts a SupabaseClient so this module is isomorphic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { reportDbError } from "./report";

export interface MyPlayer {
  /** The league feed's personId: `play_by_play_events.player.playerId`, `league_players.source_person_id`. */
  personId: string;
  name: string;
  number: string | null;
}

interface MyPlayerRow {
  person_id: string;
  name: string;
  number: string | null;
}

/** PostgREST's and Postgres's "no such table": a database the migration hasn't reached. */
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

/** The account's player, or null when the player hasn't picked themself yet (or the table isn't there yet). */
export async function getMyPlayer(supabase: SupabaseClient): Promise<MyPlayer | null> {
  const { data, error } = await supabase
    .from("my_players")
    .select("person_id, name, number")
    .eq("source", "genius")
    .maybeSingle();
  if (error) {
    if (!MISSING_TABLE.has(error.code)) reportDbError("getMyPlayer", error);
    return null;
  }
  if (!data) return null;
  const r = data as MyPlayerRow;
  return { personId: r.person_id, name: r.name, number: r.number };
}

/** Saves (or replaces) which player the account is. */
export async function setMyPlayer(supabase: SupabaseClient, player: MyPlayer): Promise<void> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error("Not authenticated");
  const number = player.number && /^[0-9]{1,3}$/.test(player.number) ? player.number : null;
  const { error } = await supabase.from("my_players").upsert(
    {
      user_id: user.id,
      source: "genius",
      person_id: String(player.personId),
      name: player.name.trim(),
      number,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,source" },
  );
  if (error) {
    reportDbError("setMyPlayer", error);
    throw new Error(`Failed to save your player: ${error.message}`);
  }
}
