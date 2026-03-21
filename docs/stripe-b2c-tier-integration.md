# Stripe B2C Tier Integration

## Context

The B2B features (orgs, teams, player licenses, invite links) are live. Now we add a B2C subscription layer for individual coaches using the web app. Stripe handles billing; Club/Team (B2B) remains offline/invoiced. The goal is gating imports, exports, and playlist sharing behind tiers enforced in the app.

---

## Tier Matrix

| Tier | Price | Imports/mo | Exports | Share to teams | Org features |
|------|-------|-----------|---------|----------------|--------------|
| `free` | $0 | 2 | No | No | No |
| `pro` | $X/mo | 10 | Yes | No | No |
| `max` | $Y/mo | Unlimited | Yes | No | No |
| `club` | Offline invoice | Unlimited | Yes | Yes | Yes (player licenses) |

- **Exports** = desktop `exportPlaylist()` call (desktop app only today)
- **Sharing** = `setPlaylistTeams()` — assigning a playlist to org teams so players can view
- **Club users** always have `org_id` set; Free/Pro/Max users have `org_id = null` (normal, not an error)

---

## Critical Design Decisions

### 1. Limits enforced in app code, not Stripe metered billing
Stripe metered billing is a billing tool, not an enforcement tool. All limits are checked in Supabase RPCs / server actions before the action executes. Stripe is the source of truth for *plan*, not for *usage count*.

### 2. Usage period = calendar month for all tiers
Simplest to explain ("2 imports this month") and simplest to implement — no need to derive billing period start from Stripe's `current_period_start`. Free users have no Stripe subscription, so calendar month is the only option anyway.

### 3. Free users get no Stripe customer record
Stripe customer + subscription created on-demand when the user first upgrades. Until then, `stripe_customer_id = NULL` in the DB.

### 4. Club tier managed out-of-band
No Stripe product for Club. Platform admins set `plan = 'club'` manually (same admin UI that sets seat limits). No webhook needed for Club.

### 5. Layout redirect change
Currently `(app)/layout.tsx` redirects any org-less user to `/onboarding`. This breaks Free/Pro/Max users who intentionally have no org. Fix: only redirect to `/onboarding` when `plan === 'club' && !orgId`.

---

## Phase 1 — Database Migration

**New migration:** `20260319000001_stripe_and_usage.sql`

### A. Add plan + Stripe fields to `profiles`

```sql
CREATE TYPE plan_tier AS ENUM ('free', 'pro', 'max', 'club');

ALTER TABLE profiles
  ADD COLUMN plan plan_tier NOT NULL DEFAULT 'free',
  ADD COLUMN stripe_customer_id text,
  ADD COLUMN stripe_subscription_id text,
  ADD COLUMN subscription_status text,        -- 'active' | 'past_due' | 'canceled' | null
  ADD COLUMN current_period_end timestamptz;  -- null for free users
```

### B. Usage tracking table

```sql
CREATE TABLE usage_tracking (
  user_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  period_start date NOT NULL,               -- first day of calendar month, e.g. 2026-03-01
  imports      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period_start)
);
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_own ON usage_tracking FOR ALL USING (user_id = auth.uid());
```

### C. Webhook idempotency table

```sql
CREATE TABLE webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type      text NOT NULL,
  processed_at    timestamptz DEFAULT now()
);
```

### D. RPC: `check_and_increment_imports()`

```sql
CREATE OR REPLACE FUNCTION check_and_increment_imports()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_plan plan_tier;
  v_limit integer;
  v_period date;
  v_count integer;
BEGIN
  SELECT plan INTO v_plan FROM profiles WHERE id = auth.uid();
  v_period := date_trunc('month', now())::date;

  -- Unlimited tiers — skip counting
  IF v_plan IN ('max', 'club') THEN RETURN; END IF;

  v_limit := CASE v_plan WHEN 'free' THEN 2 WHEN 'pro' THEN 10 END;

  INSERT INTO usage_tracking(user_id, period_start, imports)
  VALUES (auth.uid(), v_period, 0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  SELECT imports INTO v_count FROM usage_tracking
  WHERE user_id = auth.uid() AND period_start = v_period;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'import_limit_reached';
  END IF;

  UPDATE usage_tracking SET imports = imports + 1
  WHERE user_id = auth.uid() AND period_start = v_period;
END;
$$;
GRANT EXECUTE ON FUNCTION check_and_increment_imports() TO authenticated;
```

---

## Phase 2 — Stripe Setup (manual, in Stripe Dashboard)

1. Create **Product: Pro** → Price: $X/month (save Price ID as `STRIPE_PRICE_PRO`)
2. Create **Product: Max** → Price: $Y/month (save Price ID as `STRIPE_PRICE_MAX`)
3. Configure **Customer Portal**: allow upgrade/downgrade between Pro and Max, cancellation, payment method update
4. Add **Webhook endpoint** `https://yourapp.com/api/webhooks/stripe` with events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
5. Save **Webhook Signing Secret** as `STRIPE_WEBHOOK_SECRET`

**Env vars to add:**
```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_MAX=price_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
```

---

## Phase 3 — Backend API Routes

All under `apps/web/src/app/api/`.

### `POST /api/checkout`

```
apps/web/src/app/api/checkout/route.ts
```

- Auth: require session (read user from Supabase server client)
- Create Stripe customer if `stripe_customer_id` is null, save it to `profiles`
- Create Checkout Session: `mode: 'subscription'`, `line_items: [{ price: STRIPE_PRICE_PRO or MAX }]`
- `success_url = /settings/billing?success=1`, `cancel_url = /pricing`
- Return `{ url }` — client redirects to Stripe Checkout

### `POST /api/billing-portal`

```
apps/web/src/app/api/billing-portal/route.ts
```

- Auth: require session
- Load `stripe_customer_id` from `profiles` — 400 if null (free user has no portal)
- `stripe.billingPortal.sessions.create({ customer, return_url: '/settings/billing' })`
- Return `{ url }`

### `POST /api/webhooks/stripe`

```
apps/web/src/app/api/webhooks/stripe/route.ts
```

- Read raw body, verify signature with `stripe.webhooks.constructEvent`
- Check `webhook_events` for duplicate `event.id` → return 200 immediately if exists
- Insert into `webhook_events` first (idempotency lock)
- Handle events:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Read `customer`, `subscription` from session; look up `userId` via `metadata.userId` (set at checkout creation); update `profiles`: `stripe_customer_id`, `stripe_subscription_id`, `plan`, `subscription_status = 'active'` |
| `customer.subscription.updated` | Map `items[0].price.id` → plan tier; update `plan`, `subscription_status`, `current_period_end` |
| `customer.subscription.deleted` | Set `plan = 'free'`, `subscription_status = 'canceled'`, clear subscription fields |
| `invoice.payment_failed` | Set `subscription_status = 'past_due'` |

**Mapping Price ID → plan tier** (pure function, easy to test):
```typescript
function priceToTier(priceId: string): 'pro' | 'max' {
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_MAX) return 'max';
  throw new Error(`Unknown price: ${priceId}`);
}
```

**Important:** `export const dynamic = 'force-dynamic'` and disable Next.js body parsing for the webhook route (need raw body for signature verification).

---

## Phase 4 — Enforcement

### A. Import limit — `packages/shared/lib/matches-db.ts`

In `saveMatch()`, call `check_and_increment_imports()` RPC **before** upserting the match. This runs as the authenticated user, so RLS and the RPC's internal plan check both apply.

```typescript
const { error } = await supabase.rpc('check_and_increment_imports');
if (error?.message === 'import_limit_reached') {
  throw new Error('You\'ve reached your monthly import limit. Upgrade to import more.');
}
```

### B. Export gate — `apps/desktop/src/pages/organization.tsx` / export trigger

Before calling `exportPlaylist()`, check the user's plan from the profile context. If `plan === 'free'`, show an upgrade prompt instead of starting the export. No DB call needed — profile is already loaded.

### C. Share playlist gate — `apps/web/src/app/(app)/my-playlists/page.tsx`

The "Share" button (only shown to coaches/admins) should additionally check `plan === 'club'`. For Free/Pro/Max users, clicking Share shows an upgrade prompt explaining this is a Club feature.

### D. Layout redirect fix — `apps/web/src/app/(app)/layout.tsx`

Change the org-less redirect condition:

```typescript
// Before:
if (profile && !profile.orgId && !profile.isPlatformAdmin) → redirect('/onboarding')

// After:
if (profile && !profile.orgId && !profile.isPlatformAdmin && profile.plan === 'club') → redirect('/onboarding')
```

Free/Pro/Max users with no org land normally on `/my-playlists`.

---

## Phase 5 — UI

### A. `/pricing` page (public)
```
apps/web/src/app/pricing/page.tsx
```
- 4-column card layout: Free / Pro / Max / Club
- Highlights the recommended tier
- "Get started free" → `/signup`, "Upgrade to Pro/Max" → calls `/api/checkout`, "Contact us" for Club
- Shows current plan if user is logged in

### B. `/settings/billing` page
```
apps/web/src/app/(app)/settings/billing/page.tsx
```
- Current plan badge + `current_period_end`
- Usage widget: "X / Y imports used this month" (read from `usage_tracking` + plan limit)
- For paid users: "Manage subscription" button → calls `/api/billing-portal` → redirect
- For free users: "Upgrade" button → `/pricing`
- Add link to this page in the navbar avatar dropdown

### C. Upgrade prompts (inline)
When a limit is hit:
- **Import limit hit** (in desktop/web import flow): inline banner "You've used X/Y imports this month. [Upgrade to Pro →]"
- **Export blocked** (desktop): replace export button with locked state + tooltip "Exports require Pro or higher"
- **Share blocked** (web): clicking Share shows a modal "Playlist sharing is available on the Club plan. [Learn more →]"

### D. Navbar avatar dropdown addition
Add "Billing" link pointing to `/settings/billing` (web only).

---

## Shared Types Update

Add `plan` field to `UserProfile` in `packages/shared/types/org.ts`:

```typescript
export type PlanTier = 'free' | 'pro' | 'max' | 'club';

export interface UserProfile {
  // existing fields...
  plan: PlanTier;
}
```

Update the profile fetch in `(app)/layout.tsx` to include `plan`.

---

## Critical Files

| File | Change |
|------|--------|
| `supabase/migrations/20260319000001_stripe_and_usage.sql` | New: plan field, usage_tracking, webhook_events, RPC |
| `packages/shared/types/org.ts` | Add `PlanTier` type + `plan` to `UserProfile` |
| `apps/web/src/app/(app)/layout.tsx` | Fix redirect: only send `plan === 'club'` users to onboarding |
| `apps/web/src/app/api/checkout/route.ts` | New: Stripe Checkout session |
| `apps/web/src/app/api/billing-portal/route.ts` | New: Stripe Customer Portal session |
| `apps/web/src/app/api/webhooks/stripe/route.ts` | New: webhook handler |
| `apps/web/src/app/pricing/page.tsx` | New: public pricing page |
| `apps/web/src/app/(app)/settings/billing/page.tsx` | New: billing settings page |
| `apps/web/src/components/navbar.tsx` | Add Billing link to avatar dropdown |
| `packages/shared/lib/matches-db.ts` | Call `check_and_increment_imports` RPC before `saveMatch` |
| `apps/web/src/app/(app)/my-playlists/page.tsx` | Gate Share button on `plan === 'club'` |
| `apps/desktop/src/...` (export trigger) | Gate export on `plan !== 'free'` |

---

## Verification

1. Sign up fresh → `plan = 'free'`, `stripe_customer_id = null`
2. Import 2 matches → succeeds. Import 3rd → error "import limit reached"
3. On pricing page, click "Upgrade to Pro" → Stripe Checkout → complete payment
4. Webhook fires `checkout.session.completed` → `profiles.plan = 'pro'`, `subscription_status = 'active'`
5. Import up to 10 matches → succeeds. 11th → blocked
6. Click "Manage subscription" → Stripe Customer Portal → upgrade to Max → webhook updates plan to `max`
7. Import limit gone (unlimited)
8. Cancel subscription in portal → webhook → `plan = 'free'`, limits restored
9. `invoice.payment_failed` webhook → `subscription_status = 'past_due'` in DB
10. Club user (set manually) → can share playlist to teams; Free/Pro/Max user → sees upgrade prompt
11. Free user on `/my-playlists` → no redirect to `/onboarding`
12. Club user with no org → redirected to `/onboarding`
