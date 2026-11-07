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
create policy memb