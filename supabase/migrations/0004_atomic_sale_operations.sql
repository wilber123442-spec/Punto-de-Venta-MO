-- Server-side sale and void operations.
-- Prevents a cashier from changing prices/stock through direct table writes.
begin;

create function public.create_business_with_owner(
  p_name text,
  p_business_code text,
  p_owner_username text,
  p_owner_display_name text,
  p_currency_code text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_business_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if p_currency_code !~ '^[A-Z]{3}$' then raise exception 'Invalid currency code'; end if;
  insert into public.businesses (business_code, name, created_by, currency_code)
  values (lower(trim(p_business_code)), trim(p_name), (select auth.uid()), p_currency_code)
  returning id into new_business_id;
  insert into public.business_members (business_id, user_id, username, display_name, role)
  values (new_business_id, (select auth.uid()), lower(trim(p_owner_username)), trim(p_owner_display_name), 'owner');
  insert into public.business_settings (business_id) values (new_business_id);
  return new_business_id;
end;
$$;
revoke all on function public.create_business_with_owner(text, text, text, text, text) from public, anon;
grant execute on function public.create_business_with_owner(text, text, text, text, text) to authenticated;

create function public.add_inventory_lot(
  p_business_id uuid,
  p_product_id uuid,
  p_lot_id uuid,
  p_lot_number text,
  p_expires_on date,
  p_quantity numeric,
  p_unit_cost numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  product_row record;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not private.is_business_admin(p_business_id) then raise exception 'Administrator access required'; end if;
  if p_lot_id is null then raise exception 'Lot id is required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Inventory quantity must be positive'; end if;
  if p_unit_cost is not null and p_unit_cost < 0 then raise exception 'Invalid unit cost'; end if;
  select p.id, p.active into product_row
  from public.products p
  where p.business_id = p_business_id and p.id = p_product_id
  for update;
  if not found then raise exception 'Product is unavailable'; end if;
  if not product_row.active then raise exception 'Product is unavailable'; end if;

  if exists (
    select 1 from public.product_lots l
    where l.business_id = p_business_id and l.id = p_lot_id
  ) then return p_lot_id; end if;

  insert into public.product_lots (
    id, business_id, product_id, lot_number, expires_on, quantity, unit_cost
  ) values (
    p_lot_id, p_business_id, p_product_id, left(coalesce(p_lot_number, ''), 120),
    p_expires_on, p_quantity, p_unit_cost
  );
  update public.products p set stock_quantity = p.stock_quantity + p_quantity, updated_at = now()
  where p.business_id = p_business_id and p.id = p_product_id;
  insert into public.inventory_movements (
    id, business_id, product_id, lot_id, movement_type, quantity_delta,
    unit_cost, created_by
  ) values (
    gen_random_uuid(), p_business_id, p_product_id, p_lot_id, 'purchase', p_quantity,
    p_unit_cost, caller_id
  );
  return p_lot_id;
end;
$$;
revoke all on function public.add_inventory_lot(uuid, uuid, uuid, text, date, numeric, numeric) from public, anon;
grant execute on function public.add_inventory_lot(uuid, uuid, uuid, text, date, numeric, numeric) to authenticated;

revoke insert on public.sales, public.sale_items from authenticated;

create function public.record_sale(
  p_sale_id uuid,
  p_business_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_currency_code text,
  p_sold_at timestamptz,
  p_device_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_name text;
  business_currency text;
  item jsonb;
  product_row record;
  lot_row record;
  requested numeric(12,3);
  remaining numeric(12,3);
  taken numeric(12,3);
  line_total numeric(12,2);
  sale_total numeric(12,2) := 0;
  cost_total numeric(14,4);
  cost_known boolean;
  allocations jsonb;
  item_cost numeric(12,2);
  inserted_count integer;
begin
  if caller_id is null then raise exception 'Authentication required'; end if;
  if not private.is_business_member(p_business_id) then raise exception 'Business membership required'; end if;
  if p_sale_id is null then raise exception 'Sale id is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one sale item is required';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Sale has too many items'; end if;
  if length(trim(coalesce(p_payment_method, ''))) = 0 then raise exception 'Payment method is required'; end if;

  select b.currency_code into business_currency
  from public.businesses b where b.id = p_business_id;
  if business_currency is null or p_currency_code <> business_currency then
    raise exception 'Sale currency must match the business currency';
  end if;
  select m.display_name into caller_name
  from public.business_members m
  where m.business_id = p_business_id and m.user_id = caller_id and m.active;
  if caller_name is null then raise exception 'Active business membership required'; end if;

  -- A retry with the same stable sale id is safe and cannot double-charge stock.
  if exists (
    select 1 from public.sales s
    where s.business_id = p_business_id and s.id = p_sale_id and s.seller_user_id = caller_id
  ) then return p_sale_id; end if;

  insert into public.sales (
    id, business_id, seller_user_id, seller_name, sold_at, local_created_at,
    subtotal, total, payment_method, device_id, currency_code
  ) values (
    p_sale_id, p_business_id, caller_id, caller_name, coalesce(p_sold_at, now()), p_sold_at,
    0, 0, trim(p_payment_method), p_device_id, business_currency
  );

  for item in select value from jsonb_array_elements(p_items)
  loop
    requested := (item ->> 'quantity')::numeric;
    if requested is null or requested <= 0 then raise exception 'Invalid sale quantity'; end if;

    select p.id, p.name, p.barcode, p.unit_price, p.active
      into product_row
    from public.products p
    where p.business_id = p_business_id and p.id = (item ->> 'product_id')::uuid
    for update;
    if not found then raise exception 'Product is unavailable'; end if;
    if not product_row.active then raise exception 'Product is unavailable'; end if;
    if (item ->> 'unit_price')::numeric is distinct from product_row.unit_price then
      raise exception 'Product price changed; refresh the sale before charging';
    end if;

    remaining := requested;
    cost_total := 0;
    cost_known := true;
    allocations := '[]'::jsonb;
    for lot_row in
      select l.id, l.quantity, l.unit_cost
      from public.product_lots l
      where l.business_id = p_business_id and l.product_id = product_row.id
        and l.quantity > 0 and (l.expires_on is null or l.expires_on >= current_date)
      order by l.expires_on nulls last, l.created_at, l.id
      for update
    loop
      exit when remaining <= 0;
      taken := least(remaining, lot_row.quantity);
      update public.product_lots l set quantity = l.quantity - taken, updated_at = now()
      where l.business_id = p_business_id and l.id = lot_row.id;
      remaining := remaining - taken;
      allocations := allocations || jsonb_build_array(jsonb_build_object(
        'batchId', lot_row.id, 'quantity', taken, 'costPrice', lot_row.unit_cost
      ));
      if lot_row.unit_cost is null then cost_known := false;
      else cost_total := cost_total + taken * lot_row.unit_cost; end if;
      insert into public.inventory_movements (
        id, business_id, product_id, lot_id, movement_type, quantity_delta,
        unit_cost, sale_id, created_by
      ) values (
        gen_random_uuid(), p_business_id, product_row.id, lot_row.id, 'sale', -taken,
        lot_row.unit_cost, p_sale_id, caller_id
      );
    end loop;
    if remaining > 0 then raise exception 'Insufficient available stock for %', product_row.name; end if;

    update public.products p set stock_quantity = p.stock_quantity - requested, updated_at = now()
    where p.business_id = p_business_id and p.id = product_row.id
      and p.stock_quantity >= requested;
    get diagnostics inserted_count = row_count;
    if inserted_count <> 1 then raise exception 'Product stock is inconsistent'; end if;

    line_total := round(product_row.unit_price * requested, 2);
    sale_total := sale_total + line_total;
    item_cost := case when cost_known then round(cost_total / requested, 2) else null end;
    insert into public.sale_items (
      id, business_id, sale_id, product_id, product_name, barcode,
      unit_price, quantity, line_total, unit_cost, gross_profit, lot_allocations
    ) values (
      gen_random_uuid(), p_business_id, p_sale_id, product_row.id, product_row.name,
      product_row.barcode, product_row.unit_price, requested, line_total, item_cost,
      case when item_cost is null then null else round(line_total - item_cost * requested, 2) end,
      allocations
    );
  end loop;

  update public.sales s set subtotal = sale_total, total = sale_total
  where s.business_id = p_business_id and s.id = p_sale_id;
  return p_sale_id;
end;
$$;

create function public.void_sale(
  p_business_id uuid,
  p_sale_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sale_row public.sales%rowtype;
  item_row record;
  allocation jsonb;
  lot_id uuid;
  restore_quantity numeric(12,3);
  restored_lot_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  if not private.is_business_admin(p_business_id) then raise exception 'Administrator access required'; end if;
  if length(trim(coalesce(p_reason, ''))) < 4 then raise exception 'A void reason is required'; end if;

  select * into sale_row
  from public.sales s
  where s.business_id = p_business_id and s.id = p_sale_id
  for update;
  if not found then raise exception 'Sale not found'; end if;
  if sale_row.voided_at is not null then raise exception 'Sale already voided'; end if;

  for item_row in
    select i.product_id, i.product_name, i.lot_allocations
    from public.sale_items i
    where i.business_id = p_business_id and i.sale_id = p_sale_id
    order by i.created_at, i.id
  loop
    perform 1 from public.products p
    where p.business_id = p_business_id and p.id = item_row.product_id
    for update;

    for allocation in select value from jsonb_array_elements(item_row.lot_allocations)
    loop
      lot_id := (allocation ->> 'batchId')::uuid;
      restore_quantity := (allocation ->> 'quantity')::numeric;
      update public.product_lots l
      set quantity = l.quantity + restore_quantity, updated_at = now()
      where l.business_id = p_business_id and l.product_id = item_row.product_id and l.id = lot_id;
      if found then
        restored_lot_id := lot_id;
      else
        restored_lot_id := gen_random_uuid();
        insert into public.product_lots (
          id, business_id, product_id, lot_number, quantity, unit_cost
        ) values (
          restored_lot_id, p_business_id, item_row.product_id,
          'Anulación ' || right(p_sale_id::text, 8), restore_quantity,
          nullif(allocation ->> 'costPrice', '')::numeric
        );
      end if;
      update public.products p
      set stock_quantity = p.stock_quantity + restore_quantity, updated_at = now()
      where p.business_id = p_business_id and p.id = item_row.product_id;
      insert into public.inventory_movements (
        id, business_id, product_id, lot_id, movement_type, quantity_delta,
        unit_cost, sale_id, created_by
      ) values (
        gen_random_uuid(), p_business_id, item_row.product_id, restored_lot_id,
        'void', restore_quantity, nullif(allocation ->> 'costPrice', '')::numeric,
        p_sale_id, (select auth.uid())
      );
    end loop;
  end loop;

  update public.sales s
  set voided_at = now(), voided_by = (select auth.uid()), void_reason = trim(p_reason)
  where s.business_id = p_business_id and s.id = p_sale_id;
end;
$$;

revoke all on function public.record_sale(uuid, uuid, jsonb, text, text, timestamptz, uuid) from public, anon;
revoke all on function public.void_sale(uuid, uuid, text) from public, anon;
grant execute on function public.record_sale(uuid, uuid, jsonb, text, text, timestamptz, uuid) to authenticated;
grant execute on function public.void_sale(uuid, uuid, text) to authenticated;

commit;

