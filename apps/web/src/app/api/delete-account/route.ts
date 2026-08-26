import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@/lib/supabase/server";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

/**
 * Full account erasure — the store-required "delete my account".
 *
 * Serves all three apps (web via cookies, desktop/mobile via Bearer token,
 * same dual-auth shape as billing-portal). Everything user-owned already
 * cascades from auth.users; this route covers what cascades can't:
 * the personal organizations row (no owner FK), the email-keyed
 * stripe_customers row (a re-signup would inherit its plan tier), Supabase
 * Storage objects, and R2 clip/highlight files. Ordering matters: reads
 * first, tolerated external cleanup next, irreversible DB deletes last —
 * a partial failure can leave files deleted but never an orphaned
 * still-billing account.
 */

// R2 listing across many matches can take a while.
export const maxDuration = 60;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function deleteR2Prefix(r2: S3Client, bucket: string, prefix: string) {
  let continuationToken: string | undefined;
  do {
    const listed = await r2.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    const keys = (listed.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) {
      await r2.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

/** storage.list() is per-folder — walk subfolders (entries with id === null). */
async function removeStorageFolder(admin: SupabaseClient, bucket: string, prefix: string) {
  const { data: entries } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!entries || entries.length === 0) return;
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.id === null) {
      await removeStorageFolder(admin, bucket, `${prefix}/${entry.name}`);
    } else {
      files.push(`${prefix}/${entry.name}`);
    }
  }
  if (files.length > 0) await admin.storage.from(bucket).remove(files);
}

export async function POST(request: NextRequest) {
  // 1. Resolve the caller — cookie auth (web) or Bearer token (desktop/mobile).
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  let uid: string | undefined;
  let email: string | undefined;

  if (token) {
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: { getAll: () => [], setAll: () => {} },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const { data: { user } } = await sb.auth.getUser(token);
    uid = user?.id;
    email = user?.email ?? undefined;
  } else {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    uid = user?.id;
    email = user?.email ?? undefined;
  }

  if (!uid || !email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();

  // 2. Last-admin check. org_memberships is the source of truth for admin-ness.
  //    Personal orgs with no other members are collected for explicit deletion
  //    (no owner FK — cascade won't touch them).
  const { data: adminOrgs, error: orgErr } = await admin
    .from("org_memberships")
    .select("org_id, organizations!inner(name, is_personal)")
    .eq("user_id", uid)
    .eq("role", "admin");
  if (orgErr) {
    console.error("[delete-account] org lookup failed:", orgErr.message);
    return NextResponse.json({ error: "org_lookup_failed" }, { status: 500, headers: corsHeaders });
  }

  const personalOrgIds: string[] = [];
  for (const m of adminOrgs ?? []) {
    const org = m.organizations as unknown as { name: string; is_personal: boolean };
    const { data: others } = await admin
      .from("org_memberships")
      .select("user_id, role")
      .eq("org_id", m.org_id)
      .neq("user_id", uid);
    if (org.is_personal) {
      if ((others ?? []).length === 0) personalOrgIds.push(m.org_id);
      continue;
    }
    const hasOtherAdmin = (others ?? []).some((o) => o.role === "admin");
    if ((others ?? []).length > 0 && !hasOtherAdmin) {
      return NextResponse.json(
        { error: "last_admin", orgName: org.name },
        { status: 409, headers: corsHeaders },
      );
    }
  }

  // 3. Match ids BEFORE anything is deleted — they name the R2 clip prefixes.
  const { data: matches } = await admin.from("matches").select("id").eq("user_id", uid);

  // 4. Stripe: cancel an active subscription, then delete the email-keyed row
  //    so a re-signup with the same email can't inherit the old plan tier.
  const { data: sc } = await admin
    .from("stripe_customers")
    .select("id, subscription_id, subscription_status")
    .eq("email", email)
    .maybeSingle();
  if (sc?.subscription_id && ["active", "trialing"].includes(sc.subscription_status ?? "")) {
    try {
      await stripe.subscriptions.cancel(sc.subscription_id);
    } catch (err) {
      // Already-canceled is fine; anything else gets cleaned up manually —
      // erasure must proceed regardless.
      console.error("[delete-account] stripe cancel failed:", err);
    }
  }
  if (sc) await admin.from("stripe_customers").delete().eq("id", sc.id);

  // 5. Supabase Storage (non-fatal).
  for (const bucket of ["avatars", "game-videos"]) {
    try {
      await removeStorageFolder(admin, bucket, uid);
    } catch (err) {
      console.error(`[delete-account] storage cleanup failed (${bucket}):`, err);
    }
  }

  // 6. R2 (non-fatal — an R2 outage must not block erasure).
  try {
    const r2 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    const bucket = process.env.R2_BUCKET!;
    for (const m of matches ?? []) {
      await deleteR2Prefix(r2, bucket, `clips/${m.id}/`);
    }
    await deleteR2Prefix(r2, bucket, `highlights/${uid}/`);
  } catch (err) {
    console.error("[delete-account] R2 cleanup failed:", err);
  }

  // 7. Personal orgs — every inbound FK is CASCADE or SET NULL, safe to drop.
  if (personalOrgIds.length > 0) {
    const { error: orgDelErr } = await admin.from("organizations").delete().in("id", personalOrgIds);
    if (orgDelErr) console.error("[delete-account] personal org delete failed:", orgDelErr.message);
  }

  // 8. The irreversible one — fires every auth.users cascade.
  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error("[delete-account] auth delete failed:", delErr.message);
    return NextResponse.json({ error: "delete_failed" }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
