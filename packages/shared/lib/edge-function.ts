/**
 * The one way clients call a Supabase edge function that speaks our
 * `{ action, … }` protocol (genius, profixio): `supabase.functions.invoke`
 * plus extraction of the snake-case error token the function put in its
 * JSON body, so callers can branch on `unknown_league` rather than on an
 * HTTP status buried in a FunctionsHttpError.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type FunctionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function invokeEdgeFunction<T>(
  supabase: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
): Promise<FunctionResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // FunctionsHttpError carries the response; surface the snake token when present.
    let token = "request_failed";
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        token = (await ctx.json())?.error ?? token;
      } catch {
        // keep generic token
      }
    }
    return { ok: false, error: token };
  }
  return { ok: true, data: data as T };
}
