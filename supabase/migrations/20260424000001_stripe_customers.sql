create table stripe_customers (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  stripe_customer_id  text not null unique,
  subscription_id     text,
  subscription_status text,   -- 'active' | 'trialing' | 'past_due' | 'canceled' | null
  plan_name           text,   -- 'rookie' | 'pro'
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table stripe_customers enable row level security;

create policy "users read own subscription"
  on stripe_customers for select
  using (email = (select email from auth.users where id = auth.uid()));
