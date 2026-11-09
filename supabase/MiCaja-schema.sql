-- ALREADY APPLIED to Supabase project sopebnliutlghshicyxb on 2026-11-08.
-- Do not run this base schema again; use the next numbered migration only.
begin;

-- ===== supabase/migrations/0001_cloud_multitenant.sql =====
-- Cloud schema for Punto de Venta MO. Use a dedicated Supabase project.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  business_code text not null unique,
  name text not null check (char_length(trim(name)) between 2 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (business_code = lower(business_code)),
  check (business_code ~ '^[a-z0-9][a-z0-9-]{3,39}$')
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null,
  role text not null check (role in ('owner', 'admin', 'cashier')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (business_id, user_id),
  unique (business_id, username),
  check (username = lower(trim(username)) and char_length(username) between 2 and 60),
  check (char_length(trim(display_name)) between 1 and 120)
);

create table public.products (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  barcode text,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  stock_quantity numeric(12, 3) not null default 0 check (stock_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id)
);
create unique index products_business_barcode_unique
  on public.products (business_id, barcode)
  where barcode is not null and barcode <> '';

create table public.sales (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  seller_user_id uuid not null references auth.users(id) on delete restrict,
  seller_name text not null,
  sold_at timestamptz not null,
  local_created_at timestamptz,
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  total numeric(12, 2) not null check (total >= 0),
  payment_method text not null,
  device_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, id)
);
create index sales_business_sold_at_idx on public.sales (business_id, sold_at desc);

create table public.sale_items (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null,
  product_id uuid,
  product_name text not null,
  barcode text,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity numeric(12, 3) not null check (quantity > 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (business_id, sale_id) references public.sales(business_id, id) on delete cascade,
  -- Keep historical sale snapshots when a product is removed. Only clear product_id;
  -- business_id remains mandatory for tenant isolation.
  foreign key (business_id, product_id) references public.products(business_id, id) on delete set null (product_id)
);
create index sale_items_business_sale_idx on public.sale_items (business_id, sale_id);

create table public.business_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  address text not null default '',
  phone text not null default '',
  tax_id text not null default '',
  receipt_footer text not null default '¡Gracias por su compra!',
  paper_width smallint not null default 58 check (paper_width in (58, 80)),
  logo_path text,
  updated_at timestamptz not null default now()
);

create table public.monthly_closes (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  closed_by uuid not null references auth.users(id) on delete restrict,
  sales_count integer not null check (sales_count >= 0),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, period_start),
  check (period_end >= period_start)
);

create function private.is_business_member(target_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id
      and m.user_id = (select auth.uid()) and m.active
  );
$$;

create function private.is_business_admin(target_business_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id
      and m.user_id = (select auth.uid()) and m.active
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function private.is_business_member(uuid) from public;
revoke all on function private.is_business_admin(uuid) from public;
grant execute on function private.is_business_member(uuid) to authenticated;
grant execute on function private.is_business_admin(uuid) to authenticated;

create function public.create_business_with_owner(
  p_name text, p_business_code text, p_owner_username text, p_owner_display_name text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare new_business_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  insert into public.businesses (business_code, name, created_by)
  values (lower(trim(p_business_code)), trim(p_name), (select auth.uid()))
  returning id into new_business_id;
  insert into public.business_members (business_id, user_id, username, display_name, role)
  values (new_business_id, (select auth.uid()), lower(trim(p_owner_username)), trim(p_owner_display_name), 'owner');
  insert into public.business_settings (business_id) values (new_business_id);
  return new_business_id;
end;
$$;
revoke all on function public.create_business_with_owner(text, text, text, text) from public, anon;
grant execute on function public.create_business_with_owner(text, text, text, text) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.business_settings enable row level security;
alter table public.monthly_closes enable row level security;

revoke all on public.businesses, public.business_members, public.products,
  public.sales, public.sale_items, public.business_settings, public.monthly_closes from anon;
revoke all on public.businesses, public.business_members, public.products,
  public.sales, public.sale_items, public.business_settings, public.monthly_closes from authenticated;
grant select, update on public.businesses to authenticated;
grant select on public.business_members to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert on public.sales to authenticated;
grant select, insert on public.sale_items to authenticated;
grant select, insert, update on public.business_settings to authenticated;
grant select, insert on public.monthly_closes to authenticated;

create policy businesses_read_members on public.businesses for select to authenticated
  using (private.is_business_member(id));
create policy businesses_update_admin on public.businesses for update to authenticated
  using (private.is_business_admin(id)) with check (private.is_business_admin(id));
create policy members_read_self_or_admin on public.business_members for select to authenticated
  using (user_id = (select auth.uid()) or private.is_business_admin(business_id));

create policy products_read_members on public.products for select to authenticated
  using (private.is_business_member(business_id));
create policy products_insert_admin on public.products for insert to authenticated
  with check (private.is_business_admin(business_id));
create policy products_update_admin on public.products for update to authenticated
  using (private.is_business_admin(business_id)) with check (private.is_business_admin(business_id));
create policy products_delete_admin on public.products for delete to authenticated
  using (private.is_business_admin(business_id));

create policy sales_read_members on public.sales for select to authenticated
  using (private.is_business_member(business_id));
create policy sales_insert_member on public.sales for insert to authenticated
  with check (private.is_business_member(business_id) and seller_user_id = (select auth.uid()));
create policy sale_items_read_members on public.sale_items for select to authenticated
  using (private.is_business_member(business_id));
create policy sale_items_insert_own_sale on public.sale_items for insert to authenticated
  with check (
    private.is_business_member(business_id)
    and exists (
      select 1 from public.sales s
      where s.business_id = sale_items.business_id and s.id = sale_items.sale_id
        and (s.seller_user_id = (select auth.uid()) or private.is_business_admin(s.business_id))
    )
  );

create policy settings_read_members on public.business_settings for select to authenticated
  using (private.is_business_member(business_id));
create policy settings_insert_admin on public.business_settings for insert to authenticated
  with check (private.is_business_admin(business_id));
create policy settings_update_admin on public.business_settings for update to authenticated
  using (private.is_business_admin(business_id)) with check (private.is_business_admin(business_id));

create policy monthly_closes_read_members on public.monthly_closes for select to authenticated
  using (private.is_business_member(business_id));
create policy monthly_closes_insert_admin on public.monthly_closes for insert to authenticated
  with check (private.is_business_admin(business_id) and closed_by = (select auth.uid()));


-- ===== supabase/migrations/0002_lots_costs_and_reports.sql =====
-- Product lots and cost snapshots for expiry tracking and gross-profit reports.
alter table public.businesses
  add column currency_code text not null default 'NIO'
    check (currency_code ~ '^[A-Z]{3}$');

alter table public.products
  add column purchase_price numeric(12, 2)
    check (purchase_price is null or purchase_price >= 0);

create table public.product_lots (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  lot_number text not null default '',
  expires_on date,
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, product_id)
    references public.products(business_id, id) on delete cascade
);
create index product_lots_expiry_idx
  on public.product_lots (business_id, expires_on) where quantity > 0;

alter table public.sale_items
  add column unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  add column gross_profit numeric(12, 2),
  add column lot_allocations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(lot_allocations) = 'array');

alter table public.sales
  add column currency_code text not null default 'NIO'
    check (currency_code ~ '^[A-Z]{3}$'),
  add column voided_at timestamptz,
  add column voided_by uuid references auth.users(id) on delete set null,
  add column void_reason text;

create index sales_business_currency_date_idx
  on public.sales (business_id, currency_code, sold_at desc);

create table public.inventory_movements (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  lot_id uuid,
  movement_type text not null
    check (movement_type in ('purchase', 'sale', 'void', 'adjustment', 'expired')),
  quantity_delta numeric(12, 3) not null check (quantity_delta <> 0),
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  sale_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (business_id, product_id)
    references public.products(business_id, id) on delete restrict,
  foreign key (business_id, lot_id)
    references public.product_lots(business_id, id) on delete set null (lot_id),
  foreign key (business_id, sale_id)
    references public.sales(business_id, id) on delete set null (sale_id)
);
create index inventory_movements_business_created_idx
  on public.inventory_movements (business_id, created_at desc);

alter table public.product_lots enable row level security;
alter table public.inventory_movements enable row level security;
revoke all on public.product_lots, public.inventory_movements from anon;
revoke all on public.product_lots, public.inventory_movements from authenticated;
grant select, insert, update, delete on public.product_lots to authenticated;
grant select on public.inventory_movements to authenticated;

create policy product_lots_read_members on public.product_lots for select to authenticated
  using (private.is_business_member(business_id));
create policy product_lots_insert_admin on public.product_lots for insert to authenticated
  with check (private.is_business_admin(business_id));
create policy product_lots_update_admin on public.product_lots for update to authenticated
  using (private.is_business_admin(business_id)) with check (private.is_business_admin(business_id));
create policy product_lots_delete_admin on public.product_lots for delete to authenticated
  using (private.is_business_admin(business_id));
create policy inventory_movements_read_members on public.inventory_movements for select to authenticated
  using (private.is_business_member(business_id));


-- ===== supabase/migrations/0003_business_invitations.sql =====
-- Secure cashier/admin onboarding without exposing the Supabase service key.
-- The invited user first creates their own Supabase Auth account, then claims
-- the one-time invitation while signed in with the matching email address.

create table public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null,
  username text not null,
  display_name text not null,
  role text not null check (role in ('admin', 'cashier')),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (email = lower(trim(email)) and char_length(email) between 3 and 254),
  check (username = lower(trim(username)) and char_length(username) between 2 and 60),
  check (char_length(trim(display_name)) between 1 and 120),
  unique (token_hash)
);

create unique index business_invitations_pending_username_unique
  on public.business_invitations (business_id, username)
  where accepted_at is null;
create unique index business_invitations_pending_email_unique
  on public.business_invitations (business_id, email)
  where accepted_at is null;
create index business_invitations_business_created_idx
  on public.business_invitations (business_id, created_at desc);

alter table public.business_invitations enable row level security;
revoke all on public.business_invitations from anon, authenticated;
grant select on public.business_invitations to authenticated;

create policy invitations_read_admin on public.business_invitations for select to authenticated
  using (private.is_business_admin(business_id));

create function public.create_business_invitation(
  p_email text,
  p_username text,
  p_display_name text,
  p_role text,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  target_business_id uuid;
  invitation_id uuid;
  normalized_email text := lower(trim(p_email));
  normalized_username text := lower(trim(p_username));
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if p_role not in ('admin', 'cashier') then raise exception 'Invalid invited role'; end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'A valid email address is required';
  end if;
  if normalized_username !~ '^[a-z0-9][a-z0-9._-]{1,59}$' then
    raise exception 'Invalid username';
  end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation token'; end if;

  select m.business_id into target_business_id
  from public.business_members m
  where m.user_id = caller_id and m.active and m.role in ('owner', 'admin')
  order by case when m.role = 'owner' then 0 else 1 end, m.created_at
  limit 1;
  if target_business_id is null then raise exception 'Administrator access required'; end if;

  if exists (
    select 1 from public.business_members m
    where m.business_id = target_business_id and m.username = normalized_username
  ) then raise exception 'Username already belongs to a business member'; end if;

  insert into public.business_invitations (
    business_id, email, username, display_name, role, token_hash, created_by
  ) values (
    target_business_id, normalized_email, normalized_username, trim(p_display_name), p_role, p_token_hash, caller_id
  ) returning id into invitation_id;

  return invitation_id;
end;
$$;
revoke all on function public.create_business_invitation(text, text, text, text, text) from public, anon;
grant execute on function public.create_business_invitation(text, text, text, text, text) to authenticated;

create function public.accept_business_invitation(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  invitation public.business_invitations%rowtype;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if caller_email = '' then raise exception 'A verified email address is required'; end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation token'; end if;

  select * into invitation
  from public.business_invitations i
  where i.token_hash = p_token_hash
  for update;

  if not found then raise exception 'Invitation not found'; end if;
  if invitation.accepted_at is not null then raise exception 'Invitation already used'; end if;
  if invitation.expires_at <= now() then raise exception 'Invitation expired'; end if;
  if invitation.email <> caller_email then raise exception 'Invitation email does not match'; end if;

  insert into public.business_members (business_id, user_id, username, display_name, role)
  values (invitation.business_id, caller_id, invitation.username, invitation.display_name, invitation.role);

  update public.business_invitations
  set accepted_by = caller_id, accepted_at = now()
  where id = invitation.id;

  return invitation.business_id;
end;
$$;
revoke all on function public.accept_business_invitation(text) from public, anon;
grant execute on function public.accept_business_invitation(text) to authenticated;

commit;

