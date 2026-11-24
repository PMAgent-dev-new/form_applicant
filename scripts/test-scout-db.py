#!/usr/bin/env python3
"""ローカルPostgresでmigration・競合・同意・権限を実測。実在者データ/外部通信なし。
SCOUT_TEST_PG_HOST（Unix socketディレクトリ）とSCOUT_TEST_PG_PORTを指定する。
専用の一時DBを作り、成功/失敗を問わず削除する。既存DBのテーブルは変更しない。
"""
import concurrent.futures
import os
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import uuid

host = os.environ['SCOUT_TEST_PG_HOST']
if not host.startswith('/tmp/pma-scout-'):
    raise SystemExit('専用のローカルUnix socketのみ許可します')
port = os.environ.get('SCOUT_TEST_PG_PORT', '55483')
name = 'pma_scout_test_' + uuid.uuid4().hex[:12]
base = ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-h', host, '-p', port, '-At']
def sql(text, database=name):
    r = subprocess.run(base + ['-d', database], input=text, text=True, capture_output=True)
    if r.returncode:
        raise AssertionError(r.stderr)
    return [s for s in r.stdout.splitlines() if s]
staff1 = '10000000-0000-0000-0000-000000000001'
staff2 = '10000000-0000-0000-0000-000000000002'
def message(staff=staff1, keys="array['email:test','phone:test']"):
    mid = str(uuid.uuid4())
    sql(f"insert into scout_messages(id,staff_id,candidate_id,candidate_name,candidate_snapshot,email,contact_keys,job_id,job_snapshot,subject,body,from_email,reply_to,consent_snapshot,expires_at) values('{mid}','{staff}','driver:recDemo','架空の見本','{{}}','sample@example.com',{keys},'jobDemo','{{}}','件名','本文','sender@example.com','reply@example.com','{{}}',now()+interval '15 minutes');")
    return mid
def claim(mid, staff=staff1):
    return sql(f"set role service_role; select scout_claim('{mid}','{staff}',168);")[-1]

sql(f'create database {name};', 'postgres')
try:
    sql("""do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table submissions(source text,submission_id text,applicant jsonb,context jsonb,received_at timestamptz);
    create table submission_vault(source text,submission_id text,payload jsonb,created_at timestamptz);
    grant select on submissions,submission_vault to service_role;
    """)
    sql((Path(__file__).resolve().parents[1]/'supabase/migrations/202611240001_scout.sql').read_text())
    sql((Path(__file__).resolve().parents[1]/'supabase/migrations/202611240002_scout_groups.sql').read_text())
    sql(f"insert into auth.users values('{staff1}'),('{staff2}'); insert into scout_staff(id,email,display_name,active) values('{staff1}','one@example.com','担当1',true),('{staff2}','two@example.com','担当2',true);")
    assert sql("select has_table_privilege('anon','scout_messages','SELECT'),has_table_privilege('authenticated','scout_messages','INSERT'),has_function_privilege('anon','scout_claim(uuid,uuid,integer)','EXECUTE');")[-1] == 'f|f|f'
    print('PASS anon/authenticated cannot read/send')
    a,b=message(),message(staff2)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda x:claim(*x),[(a,staff1),(b,staff2)]))
    assert sorted(results)==['claimed','unresolved'],results
    winner=a if results[0]=='claimed' else b
    winner_staff=staff1 if winner==a else staff2
    assert claim(winner,winner_staff)=='sending'
    print('PASS simultaneous staff sends accept exactly one; repeat is not claimed')
    sql(f"select scout_finish('{winner}','{winner_staff}','accepted','provider-demo');")
    assert claim(message())=='cooldown'
    print('PASS accepted send enforces cross-staff cooldown')
    sql(f"update scout_messages set status='sending' where id='{winner}';")
    sql(f"select scout_finish('{winner}','{winner_staff}','unknown',null); update scout_contact_locks set last_sent_at=now()-interval '30 days';")
    assert claim(message())=='unresolved'
    print('PASS unknown outcome remains blocked after cooldown')
    c=message(keys="array['email:stopped']")
    sql(f"insert into scout_unsubscribe_tokens values('token-hash','email:stopped','sample@example.com','{c}',now());")
    assert sql("set role service_role; select scout_unsubscribe('token-hash');")[-1]=='email:stopped'
    assert claim(c)=='suppressed'
    assert sql("select count(*) from scout_suppressions where email_key='email:stopped';")[-1]=='1'
    print('PASS recipient optout prevents sending')
    d=message(keys="array['email:expired']")
    sql(f"update scout_messages set expires_at=now()-interval '1 minute' where id='{d}';")
    assert claim(d)=='expired'
    print('PASS expired previews cannot send')
    sql("""insert into submissions values ('form_applicant/applicants','reused','{"email":"sample@example.com"}','{}','2026-11-20');
      insert into submission_vault values ('form_applicant/applicants','reused','{"email":"sample@example.com","marketing_consent":{"accepted":true}}','2026-11-21');""")
    assert sql('select count(*) from scout_consent_evidence();')[-1]=='0'
    print('PASS later vault consent does not replace initial missing consent')
    sql("insert into submissions values ('form_applicant/applicants','original','{\"email\":\"sample@example.com\",\"phone_number\":\"09012345678\"}','{\"marketing_consent\":{\"accepted\":true}}','2026-11-22');")
    assert sql('set role service_role; select count(*) from scout_consent_evidence();')[-1]=='1'
    print('PASS original consent available only to server role')
    assert sql("select has_table_privilege('anon','scout_proposals','SELECT'),has_table_privilege('authenticated','scout_batches','INSERT'),has_function_privilege('authenticated','scout_ai_reserve(uuid,integer)','EXECUTE');")[-1] == 'f|f|f'
    print('PASS group tables and functions remain server-only')
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results=list(pool.map(lambda _:sql(f"select scout_ai_reserve('{staff1}',5);")[-1],range(12)))
    assert results.count('t')==5,results
    print('PASS monthly AI quota is atomic across concurrent requests')

    def prepare_group(n):
        bid,pid=str(uuid.uuid4()),str(uuid.uuid4())
        sql(f"insert into scout_proposals(id,staff_id,job_snapshot,plan,model,provenance,expires_at) values('{pid}','{staff1}','{{}}','{{}}','fake-model','{{}}',now()+interval '1 day');")
        expires=(datetime.now(timezone.utc)+timedelta(minutes=15)).isoformat()
        messages,tokens=[],[]
        for i in range(n):
            mid=str(uuid.uuid4());email=f'member{i}@example.com';key=f'email:{bid}:{i}'
            messages.append(dict(id=mid,staff_id=staff1,candidate_id=f'driver:{i}',candidate_name='架空の見本',candidate_snapshot={},email=email,contact_keys=[key],job_id='demo',job_snapshot={},subject='件名',body='本文',from_email='ridejob@pmagent.jp',reply_to='reply@example.com',consent_snapshot={},status='draft',provider_id=None,created_at=datetime.now(timezone.utc).isoformat(),expires_at=expires,sent_at=None,outcome='none',batch_id=bid,batch_index=i))
            tokens.append(dict(token_hash=f'token-{bid}-{i}',email_key=key,email=email,message_id=mid))
        enc=lambda x: "'"+json.dumps(x,ensure_ascii=False).replace("'","''")+"'::jsonb"
        payload=dict(id=bid,staff_id=staff1,proposal_id=pid,total=n,expires_at=expires)
        sql(f"select scout_prepare_batch({enc(payload)},{enc(messages)},{enc(tokens)});")
        return bid,[m['id'] for m in messages]
    bid,mids=prepare_group(300)
    assert sql(f"select total,(select count(*) from scout_messages where batch_id='{bid}') from scout_batches where id='{bid}';")[-1]=='300|300'
    try:
        prepare_group(301)
        raise RuntimeError('301 accepted')
    except AssertionError as e:
        assert 'invalid batch size' in str(e)
    print('PASS 300 immutable drafts created atomically; 301 rejected')
    action=lambda a:sql(f"select scout_batch_action('{bid}','{staff1}','{a}');")[-1]
    reserve=lambda:json.loads(sql(f"select scout_batch_reserve('{bid}','{staff1}');")[-1])
    assert reserve()['status']=='prepared'
    assert claim(mids[0])=='batch_not_approved'
    assert sql(f"select scout_batch_action('{bid}','{staff2}','approve');")[-1]=='forbidden'
    assert action('approve')=='ok'
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        attempts=list(pool.map(lambda _:reserve(),range(2)))
    assert sorted(x['status'] for x in attempts)==['busy','reserved']
    assert action('pause')=='ok'
    assert claim(mids[0])=='batch_not_approved'
    sql(f"select scout_batch_finish_step('{bid}','{staff1}','{mids[0]}','中断');")
    assert action('resume')=='ok'
    assert reserve()['messageId']==mids[0]
    assert claim(mids[0])=='claimed'
    assert claim(mids[0])=='sending'
    sql(f"select scout_finish('{mids[0]}','{staff1}','accepted','fake-provider'); select scout_batch_finish_step('{bid}','{staff1}','{mids[0]}',null);")
    assert reserve()['messageId']==mids[1]
    assert claim(mids[1])=='claimed'
    sql(f"select scout_finish('{mids[1]}','{staff1}','unknown',null); select scout_batch_finish_step('{bid}','{staff1}','{mids[1]}','結果未確認');")
    assert action('resume')=='unresolved'
    assert reserve()['status']=='paused'
    print('PASS owner/approval/pause boundaries, one reservation, sent members skipped, unknown never resumed')
    bid2,mids2=prepare_group(1)
    sql(f"update scout_batches set expires_at=now()-interval '1 second' where id='{bid2}';")
    assert sql(f"select scout_batch_action('{bid2}','{staff1}','approve');")[-1]=='invalid_state'
    bid3,mids3=prepare_group(1)
    sql(f"select scout_batch_action('{bid3}','{staff1}','approve'); update scout_batches set send_until=now()-interval '1 second' where id='{bid3}';")
    assert json.loads(sql(f"select scout_batch_reserve('{bid3}','{staff1}');")[-1])['status']=='expired'
    assert claim(mids3[0])=='batch_not_approved'
    print('PASS approval expiry and delivery deadline cannot be extended by repeat clicks')
finally:
    sql(f'drop database {name} with (force);','postgres')
