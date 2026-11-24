-- PMAの個別メールスカウト。既存応募テーブル・同意・配信停止は変更しない。
begin;
create table public.scout_staff (
  id uuid primary key references auth.users(id), email text not null unique,
  display_name text not null, active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.scout_messages (
  id uuid primary key, staff_id uuid not null references public.scout_staff(id),
  candidate_id text not null, candidate_name text not null, candidate_snapshot jsonb not null,
  email text not null, contact_keys text[] not null check(cardinality(contact_keys) between 1 and 2),
  job_id text not null, job_snapshot jsonb not null, subject text not null, body text not null,
  from_email text not null, reply_to text not null, consent_snapshot jsonb not null,
  status text not null default 'draft' check(status in ('draft','sending','accepted','unknown')),
  provider_id text, created_at timestamptz not null default now(), expires_at timestamptz not null,
  sent_at timestamptz, outcome text not null default 'none' check(outcome in ('none','replied','meeting','declined'))
);
create index scout_messages_created on public.scout_messages(created_at desc);
create table public.scout_contact_locks (
  contact_key text primary key, last_message uuid references public.scout_messages(id), last_sent_at timestamptz
);
create table public.scout_unsubscribe_tokens (
  token_hash text primary key, email_key text not null, email text not null,
  message_id uuid not null references public.scout_messages(id), created_at timestamptz not null default now()
);
create table public.scout_suppressions (
  email_key text primary key, stopped_at timestamptz not null default now(),
  lark_synced_at timestamptz, reason text not null default 'recipient_unsubscribe'
);
create table public.scout_audit (
  id bigint generated always as identity primary key, at timestamptz not null default now(),
  staff_id uuid references public.scout_staff(id), message_id uuid references public.scout_messages(id),
  event text not null, detail jsonb not null default '{}'::jsonb
);
create table public.scout_auth_limits (
  key_hash text primary key, window_start timestamptz not null, attempts integer not null
);
-- 全テーブルをブラウザーのanon/authenticatedから隔離。自社APIだけが操作する。
do $$ declare t text; begin
  foreach t in array array['scout_staff','scout_messages','scout_contact_locks','scout_unsubscribe_tokens','scout_suppressions','scout_audit','scout_auth_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
grant usage, select on sequence public.scout_audit_id_seq to service_role;

-- 同意の無い初回受付も含めて先に重複排除する。後続の退避データで同意を補完しない。
create function public.scout_consent_evidence() returns table (
  source text, submission_id text, email text, phone text, recorded timestamptz, consent jsonb, is_test boolean
) language sql stable security invoker set search_path = public, pg_temp as $$
  with raw as (
    select s.source,s.submission_id,s.applicant as applicant,s.context->'marketing_consent' as consent,s.received_at as recorded,0 as priority from submissions s
    union all
    select v.source,v.submission_id,v.payload,v.payload->'marketing_consent',v.created_at,1 from submission_vault v
  ), first_event as (
    select distinct on (r.source,r.submission_id) * from raw r
    where r.source in ('form_applicant/applicants','jobmadley/applications','jobmadley/submit-application')
    order by r.source,r.submission_id,r.recorded,r.priority
  )
  select f.source,f.submission_id,f.applicant->>'email',coalesce(f.applicant->>'phone_number',f.applicant->>'phoneNumber',f.applicant->>'phone'),f.recorded,f.consent,coalesce(f.applicant->>'is_test','false')='true'
  from first_event f where f.consent is not null;
$$;
revoke all on function public.scout_consent_evidence() from public,anon,authenticated;
grant execute on function public.scout_consent_evidence() to service_role;

create function public.scout_auth_attempt(p_keys text[]) returns boolean language plpgsql security invoker set search_path = public, pg_temp as $$
declare k text; n integer; permitted boolean := true;
begin
  for k in select distinct unnest(p_keys) order by 1 loop
    insert into scout_auth_limits values(k,now(),1) on conflict(key_hash) do update
    set attempts=case when scout_auth_limits.window_start < now()-interval '15 minutes' then 1 else scout_auth_limits.attempts+1 end,
        window_start=case when scout_auth_limits.window_start < now()-interval '15 minutes' then now() else scout_auth_limits.window_start end
    returning attempts into n;
    if n > 10 then permitted := false; end if;
  end loop;
  return permitted;
end $$;

-- 同じ連絡先を担当者横断でロック。送信結果不明は期限で解除しない。
create function public.scout_claim(p_id uuid, p_staff uuid, p_cooldown_hours integer) returns text language plpgsql security invoker set search_path = public, pg_temp as $$
declare m scout_messages; k text; l scout_contact_locks; previous text;
begin
  if p_cooldown_hours is null or p_cooldown_hours < 1 then return 'configuration_required'; end if;
  select * into m from scout_messages where id=p_id and staff_id=p_staff for update;
  if not found then return 'not_found'; end if;
  if not exists(select 1 from scout_staff where id=p_staff and active) then return 'forbidden'; end if;
  if m.status <> 'draft' then return m.status; end if;
  if m.expires_at < now() then return 'expired'; end if;
  for k in select distinct unnest(m.contact_keys) order by 1 loop
    insert into scout_contact_locks(contact_key) values(k) on conflict do nothing;
    select * into l from scout_contact_locks where contact_key=k for update;
    if exists(select 1 from scout_suppressions where email_key=k) then return 'suppressed'; end if;
    if l.last_message is not null then
      select status into previous from scout_messages where id=l.last_message;
      if previous in ('sending','unknown') then return 'unresolved'; end if;
      if l.last_sent_at > now()-make_interval(hours=>p_cooldown_hours) then return 'cooldown'; end if;
    end if;
  end loop;
  update scout_messages set status='sending',sent_at=now() where id=p_id;
  update scout_contact_locks set last_message=p_id,last_sent_at=now() where contact_key=any(m.contact_keys);
  insert into scout_audit(staff_id,message_id,event) values(p_staff,p_id,'send_claimed');
  return 'claimed';
end $$;

create function public.scout_finish(p_id uuid,p_staff uuid,p_status text,p_provider text) returns void language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if p_status not in ('accepted','unknown') then raise exception 'invalid status'; end if;
  update scout_messages set status=p_status,provider_id=p_provider where id=p_id and staff_id=p_staff and status='sending';
  if found then insert into scout_audit(staff_id,message_id,event) values(p_staff,p_id,p_status); end if;
end $$;

create function public.scout_unsubscribe(p_token_hash text) returns text language plpgsql security invoker set search_path = public, pg_temp as $$
declare t scout_unsubscribe_tokens;
begin
  select * into t from scout_unsubscribe_tokens where token_hash=p_token_hash;
  if not found then return null; end if;
  insert into scout_contact_locks(contact_key) values(t.email_key) on conflict do nothing;
  perform 1 from scout_contact_locks where contact_key=t.email_key for update;
  insert into scout_suppressions(email_key) values(t.email_key) on conflict do nothing;
  insert into scout_audit(message_id,event) values(t.message_id,'unsubscribed');
  return t.email_key;
end $$;
revoke all on function public.scout_auth_attempt(text[]),public.scout_claim(uuid,uuid,integer),public.scout_finish(uuid,uuid,text,text),public.scout_unsubscribe(text) from public,anon,authenticated;
grant execute on function public.scout_auth_attempt(text[]),public.scout_claim(uuid,uuid,integer),public.scout_finish(uuid,uuid,text,text),public.scout_unsubscribe(text) to service_role;
commit;
