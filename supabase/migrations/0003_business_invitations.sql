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

