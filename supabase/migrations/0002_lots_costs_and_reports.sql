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
