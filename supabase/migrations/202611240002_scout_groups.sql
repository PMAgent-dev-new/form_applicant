-- AI提案・一括承認。応募者データをAIへ送らず、メールは各人へ個別配送。
begin;
create table public.scout_proposals (
  id uuid primary key, staff_id uuid not null references scout_staff(id),
  job_snapshot jsonb not null, plan jsonb not null, model text not null, provenance jsonb not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table public.scout_ai_usage (month date primary key, attempts integer not null default 0);
create table public.scout_batches (
  id uuid primary key, staff_id uuid not null references scout_staff(id), proposal_id uuid not null references scout_proposals(id),
  total integer not null check(total between 1 and 300),
  status text not null default 'prepared' check(status in ('prepared','approved','paused','completed')),
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  approved_at timestamptz, send_until timestamptz, active_message uuid references scout_messages(id), last_error text
);
alter table scout_messages add column batch_id uuid references scout_batches(id), add column batch_index integer;
create unique index scout_batch_order on scout_messages(batch_id,batch_index) where batch_id is not null;
create index scout_batches_owner on scout_batches(staff_id,created_at desc);
do $$ declare t text; begin
  foreach t in array array['scout_proposals','scout_ai_usage','scout_batches'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function scout_ai_reserve(p_staff uuid,p_limit integer) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare month_key date := date_trunc('month',now() at time zone 'Asia/Tokyo')::date; n integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or not exists(select 1 from scout_staff where id=p_staff and active) then return false; end if;
  insert into scout_ai_usage values(month_key,0) on conflict do nothing;
  select attempts into n from scout_ai_usage where month=month_key for update;
  if n >= p_limit then return false; end if;
  update scout_ai_usage set attempts=attempts+1 where month=month_key;
  insert into scout_audit(staff_id,event) values(p_staff,'claude_generation_reserved');
  return true;
end $$;

create function scout_prepare_batch(p_batch jsonb,p_messages jsonb,p_tokens jsonb) returns uuid language plpgsql security invoker set search_path=public,pg_temp as $$
declare b scout_batches; n integer; row_item jsonb;
begin
  b.id:=(p_batch->>'id')::uuid; b.staff_id:=(p_batch->>'staff_id')::uuid; b.proposal_id:=(p_batch->>'proposal_id')::uuid;
  n:=jsonb_array_length(p_messages);
  if n is null or n < 1 or n > 300 or n <> (p_batch->>'total')::int or n <> jsonb_array_length(p_tokens) then raise exception 'invalid batch size'; end if;
  if not exists(select 1 from scout_staff where id=b.staff_id and active) or
     not exists(select 1 from scout_proposals where id=b.proposal_id and staff_id=b.staff_id and expires_at>now()) then raise exception 'not authorized'; end if;
  for row_item in select * from jsonb_array_elements(p_messages) loop
    if (row_item->>'staff_id')::uuid <> b.staff_id or (row_item->>'batch_id')::uuid <> b.id or row_item->>'status' <> 'draft' then raise exception 'invalid member'; end if;
  end loop;
  insert into scout_batches(id,staff_id,proposal_id,total,expires_at) values(b.id,b.staff_id,b.proposal_id,n,now()+interval '15 minutes');
  insert into scout_messages select * from jsonb_populate_recordset(null::scout_messages,p_messages);
  insert into scout_unsubscribe_tokens(token_hash,email_key,email,message_id)
    select token_hash,email_key,email,message_id from jsonb_to_recordset(p_tokens) as x(token_hash text,email_key text,email text,message_id uuid);
  insert into scout_audit(staff_id,event,detail) values(b.staff_id,'batch_prepared',jsonb_build_object('batchId',b.id,'count',n));
  return b.id;
end $$;

create function scout_batch_action(p_id uuid,p_staff uuid,p_action text) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare b scout_batches; m scout_messages;
begin
  select * into b from scout_batches where id=p_id and staff_id=p_staff for update;
  if not found or not exists(select 1 from scout_staff where id=p_staff and active) then return 'forbidden'; end if;
  if p_action='pause' and b.status in ('approved','paused') then
    update scout_batches set status='paused' where id=p_id;
  elsif p_action='approve' and b.status='prepared' and b.expires_at>now() then
    update scout_batches set status='approved',approved_at=now(),send_until=now()+interval '2 hours' where id=p_id;
    update scout_messages set expires_at=now()+interval '2 hours' where batch_id=p_id and status='draft';
  elsif p_action='resume' and b.status in ('approved','paused') and b.send_until>now() then
    if b.active_message is not null then
      select * into m from scout_messages where id=b.active_message;
      if m.status <> 'accepted' then return 'unresolved'; end if;
    end if;
    if exists(select 1 from scout_messages where batch_id=p_id and status in ('sending','unknown')) then return 'unresolved'; end if;
    update scout_batches set status='approved',active_message=null,last_error=null where id=p_id;
  else return 'invalid_state'; end if;
  insert into scout_audit(staff_id,event,detail) values(p_staff,'batch_'||p_action,jsonb_build_object('batchId',p_id));
  return 'ok';
end $$;

create function scout_batch_reserve(p_id uuid,p_staff uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b scout_batches; mid uuid;
begin
  select * into b from scout_batches where id=p_id and staff_id=p_staff for update;
  if not found or not exists(select 1 from scout_staff where id=p_staff and active) then return jsonb_build_object('status','forbidden'); end if;
  if b.status <> 'approved' then return jsonb_build_object('status',b.status); end if;
  if b.send_until <= now() then
    update scout_batches set status='paused',last_error='送信期限が切れました。未送信分を確認して作り直してください' where id=p_id;
    return jsonb_build_object('status','expired');
  end if;
  if b.active_message is not null then return jsonb_build_object('status','busy'); end if;
  select id into mid from scout_messages where batch_id=p_id and status='draft' order by batch_index limit 1;
  if mid is null then
    update scout_batches set status='completed' where id=p_id;
    return jsonb_build_object('status','completed');
  end if;
  update scout_batches set active_message=mid where id=p_id;
  return jsonb_build_object('status','reserved','messageId',mid);
end $$;

create function scout_batch_finish_step(p_id uuid,p_staff uuid,p_message uuid,p_error text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare b scout_batches; s text;
begin
  select * into b from scout_batches where id=p_id and staff_id=p_staff for update;
  if not found or b.active_message is distinct from p_message then return; end if;
  select status into s from scout_messages where id=p_message and batch_id=p_id;
  update scout_batches set active_message=null,
    status=case when p_error is not null or s <> 'accepted' then 'paused'
      when not exists(select 1 from scout_messages where batch_id=p_id and status='draft') then 'completed'
      else b.status end,
    last_error=left(p_error,300) where id=p_id;
end $$;

-- 個別送信エンドポイントを呼んでもグループの承認・予約を迂回できない。
create or replace function public.scout_claim(p_id uuid,p_staff uuid,p_cooldown_hours integer) returns text language plpgsql security invoker set search_path=public,pg_temp as $$
declare m scout_messages; k text; l scout_contact_locks; previous text; bid uuid;
begin
  if p_cooldown_hours is null or p_cooldown_hours <> 168 then return 'configuration_required'; end if;
  -- batch → message の順にロックし、承認/停止と同じ順序にする。
  select batch_id into bid from scout_messages where id=p_id and staff_id=p_staff;
  if bid is not null then
    perform 1 from scout_batches where id=bid and staff_id=p_staff and status='approved' and active_message=p_id and send_until>now() for update;
    if not found then return 'batch_not_approved'; end if;
  end if;
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
      if l.last_sent_at > now()-interval '7 days' then return 'cooldown'; end if;
    end if;
  end loop;
  update scout_messages set status='sending',sent_at=now() where id=p_id;
  update scout_contact_locks set last_message=p_id,last_sent_at=now() where contact_key=any(m.contact_keys);
  insert into scout_audit(staff_id,message_id,event) values(p_staff,p_id,'send_claimed');
  return 'claimed';
end $$;
revoke all on function scout_ai_reserve(uuid,integer),scout_prepare_batch(jsonb,jsonb,jsonb),scout_batch_action(uuid,uuid,text),scout_batch_reserve(uuid,uuid),scout_batch_finish_step(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function scout_ai_reserve(uuid,integer),scout_prepare_batch(jsonb,jsonb,jsonb),scout_batch_action(uuid,uuid,text),scout_batch_reserve(uuid,uuid),scout_batch_finish_step(uuid,uuid,uuid,text) to service_role;
commit;
