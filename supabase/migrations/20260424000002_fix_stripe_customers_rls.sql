drop policy "users read own subscription" on stripe_customers;

create policy "users read own subscription"
  on stripe_customers for select
  using (email = (auth.jwt() ->> 'email'));
