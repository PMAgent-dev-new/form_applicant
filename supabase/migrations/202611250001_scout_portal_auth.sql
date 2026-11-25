-- Apply after pma-internal-tools db/004_scout_access.sql. No Auth users are created.
begin;
do $$ begin
  if exists(select 1 from public.scout_staff) then
    raise exception 'Existing scout staff require an explicit identity migration';
  end if;
end $$;
alter table public.scout_staff drop constraint scout_staff_id_fkey;
alter table public.scout_staff add constraint scout_staff_id_fkey foreign key(id) references pma_tools.staff(id);
create table public.scout_portal_nonces(nonce uuid primary key, expires_at timestamptz not null);
alter table public.scout_portal_nonces enable row level security;
revoke all on public.scout_portal_nonces from public,anon,authenticated;
grant all on public.scout_portal_nonces to service_role;

create function public.scout_portal_auth(p_staff uuid,p_email text,p_session text,p_nonce uuid,p_issued timestamptz,p_policy text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare found_staff record;
begin
  if p_issued is null or p_issued < clock_timestamp()-interval '60 seconds' or p_issued > clock_timestamp()+interval '5 seconds' or p_policy is distinct from '2026-11-25-scout-v1' then return null; end if;
  select s.id,s.email,s.display_name into found_staff
  from public.scout_staff s join pma_tools.staff p on p.id=s.id
  join pma_tools.sessions x on x.staff_id=p.id
  where s.id=p_staff and s.active and p.active and p.scout_access
    and s.email=p_email and p.email=p_email and x.token_hash=p_session and x.expires_at>now()
    and exists(select 1 from pma_tools.audit a where a.staff_id=p.id and a.action='policy_accept' and a.result=p_policy);
  if not found then return null; end if;
  delete from public.scout_portal_nonces where expires_at<now();
  insert into public.scout_portal_nonces(nonce,expires_at) values(p_nonce,now()+interval '2 minutes') on conflict do nothing;
  if not found then return null; end if;
  return jsonb_build_object('id',found_staff.id,'email',found_staff.email,'display_name',found_staff.display_name);
end $$;
revoke all on function public.scout_portal_auth(uuid,text,text,uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.scout_portal_auth(uuid,text,text,uuid,timestamptz,text) to service_role;

-- Revocation also stops a batch that was already approved. Re-enabling the portal
-- role does not silently re-enable the scout sender record.
create function public.scout_revoke_portal_staff() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not new.active or not new.scout_access then
    update public.scout_staff set active=false where id=new.id;
    update public.scout_batches set status='paused',last_error='staff_access_revoked' where staff_id=new.id and status='approved';
  end if;
  return new;
end $$;
revoke all on function public.scout_revoke_portal_staff() from public,anon,authenticated;
create trigger scout_portal_staff_revoked after update of active,scout_access on pma_tools.staff
for each row execute function public.scout_revoke_portal_staff();
commit;
