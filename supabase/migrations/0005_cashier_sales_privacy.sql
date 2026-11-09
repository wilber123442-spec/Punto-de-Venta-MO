-- Each cashier can read only sales they created; admins retain full business visibility.
begin;
drop policy if exists sales_read_members on public.sales;
create policy sales_read_own_or_admin on public.sales for select to authenticated
  using (seller_user_id = (select auth.uid()) or private.is_business_admin(business_id));

drop policy if exists sale_items_read_members on public.sale_items;
create policy sale_items_read_own_or_admin on public.sale_items for select to authenticated
  using (
    private.is_business_admin(business_id)
    or exists (
      select 1 from public.sales s
      where s.business_id = sale_items.business_id
        and s.id = sale_items.sale_id
        and s.seller_user_id = (select auth.uid())
    )
  );
commit;
