-- Application tables. Only server-side service_role can mutate them.
-- Browser users have read-only RLS access to their own records; anonymous users have none.
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  revision integer not null default 1 check (revision > 0),
  published jsonb,
  published_revision integer,
  token text unique,
  status text not null default 'draft' check (status in ('draft','published','closed')),
  filename text not null,
  source_path text unique not null,
  source_bytes bigint not null check (source_bytes between 1 and 12582912),
  pages jsonb not null check (jsonb_array_length(pages) between 1 and 50),
  response_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  definition jsonb not null,
  version integer not null,
  answers jsonb not null,
  receipt_token text unique not null,
  idempotency_key uuid not null,
  payload_hash text not null,
  submitted_at timestamptz not null default now(),
  unique(form_id,idempotency_key)
);
create table public.uploads (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  filename text not null,
  declared_bytes bigint not null check (declared_bytes between 1 and 12582912),
  staging_path text unique not null,
  expires_at timestamptz not null default now() + interval '30 minutes',
  completed_at timestamptz
);
create table public.rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
-- Durable garbage collection: Storage deletion and Postgres transactions cannot be atomic.
create table public.storage_gc (
  path text primary key,
  delete_after timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index forms_owner_updated on public.forms(owner_id,updated_at desc);
create index submissions_form_date on public.submissions(form_id,submitted_at desc);
create index uploads_expiry on public.uploads(expires_at);
create index storage_gc_due on public.storage_gc(delete_after);

alter table public.forms enable row level security;
alter table public.submissions enable row level security;
alter table public.uploads enable row level security;
alter table public.rate_limits enable row level security;
alter table public.storage_gc enable row level security;
revoke all on public.forms,public.submissions,public.uploads,public.rate_limits,public.storage_gc from anon,authenticated;
grant select on public.forms,public.submissions to authenticated;
grant all on public.forms,public.submissions,public.uploads,public.rate_limits,public.storage_gc to service_role;
create policy owner_reads_forms on public.forms for select to authenticated using (owner_id=(select auth.uid()) and deleted_at is null);
create policy owner_reads_submissions on public.submissions for select to authenticated using (
  exists(select 1 from public.forms f where f.id=form_id and f.owner_id=(select auth.uid()) and f.deleted_at is null)
);

create function public.reserve_upload(p_owner uuid,p_id uuid,p_filename text,p_size bigint)
returns public.uploads language plpgsql security definer set search_path='' as $$
declare result public.uploads;
begin
  -- Serializes quota accounting across all instances for this account.
  perform 1 from auth.users where id=p_owner for update;
  if not found then raise exception 'account_missing'; end if;
  if (select count(*) from public.forms where owner_id=p_owner) +
     (select count(*) from public.uploads where owner_id=p_owner and completed_at is null and expires_at>now()) >= 50
    then raise exception 'quota_forms'; end if;
  if (select count(*) from public.uploads where owner_id=p_owner and completed_at is null and expires_at>now()) >= 5
    then raise exception 'quota_pending'; end if;
  if coalesce((select sum(source_bytes) from public.forms where owner_id=p_owner),0) +
     coalesce((select sum(declared_bytes) from public.uploads where owner_id=p_owner and completed_at is null and expires_at>now()),0) + p_size > 104857600
    then raise exception 'quota_storage'; end if;
  insert into public.uploads(id,owner_id,filename,declared_bytes,staging_path)
  values(p_id,p_owner,p_filename,p_size,'staging/'||p_owner||'/'||p_id||'.pdf') returning * into result;
  -- Signed upload tokens can outlive the reservation. Keep the cleanup task past token expiry.
  insert into public.storage_gc(path,delete_after) values(result.staging_path,now()+interval '3 hours');
  return result;
end $$;
create function public.register_form(p_owner uuid,p_upload uuid,p_pages jsonb,p_definition jsonb,p_size bigint)
returns public.forms language plpgsql security definer set search_path='' as $$
declare u public.uploads; f public.forms;
begin
  perform 1 from auth.users where id=p_owner for update;
  select * into u from public.uploads where id=p_upload and owner_id=p_owner for update;
  if not found then raise exception 'upload_missing'; end if;
  select * into f from public.forms where id=p_upload and owner_id=p_owner;
  if found then return f; end if;
  if u.completed_at is not null or u.expires_at<now() then raise exception 'upload_expired'; end if;
  if p_size<>u.declared_bytes then raise exception 'upload_size'; end if;
  insert into public.forms(id,owner_id,filename,source_path,source_bytes,pages,draft)
  values(u.id,p_owner,u.filename,'sources/'||p_owner||'/'||u.id||'.pdf',p_size,p_pages,p_definition) returning * into f;
  update public.uploads set completed_at=now() where id=p_upload;
  delete from public.storage_gc where path=f.source_path;
  return f;
end $$;
create function public.accept_submission(p_form uuid,p_version integer,p_definition jsonb,p_values jsonb,p_key uuid,p_hash text,p_receipt text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f public.forms; s public.submissions;
begin
  -- The row lock protects publication/closure, retry deduplication and the response quota together.
  select * into f from public.forms where id=p_form and deleted_at is null for update;
  if not found then raise exception 'form_missing'; end if;
  select * into s from public.submissions where form_id=p_form and idempotency_key=p_key;
  if found then
    if s.payload_hash<>p_hash then raise exception 'retry_conflict'; end if;
    return jsonb_build_object('id',s.id,'receipt',s.receipt_token,'submittedAt',s.submitted_at,'created',false);
  end if;
  if f.status<>'published' then raise exception 'form_closed'; end if;
  if f.published_revision<>p_version or f.published<>p_definition then raise exception 'version_conflict'; end if;
  if f.response_count>=1000 then raise exception 'quota_responses'; end if;
  insert into public.submissions(form_id,definition,version,answers,receipt_token,idempotency_key,payload_hash)
  values(p_form,f.published,p_version,p_values,p_receipt,p_key,p_hash) returning * into s;
  update public.forms set response_count=response_count+1 where id=p_form;
  return jsonb_build_object('id',s.id,'receipt',s.receipt_token,'submittedAt',s.submitted_at,'created',true);
end $$;
create function public.take_rate_limit(p_key text,p_max integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.rate_limits as r(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set count=case when r.expires_at<=now() then 1 else r.count+1 end,
    expires_at=case when r.expires_at<=now() then excluded.expires_at else r.expires_at end
  returning count into n;
  return n<=p_max;
end $$;
create function public.prepare_cleanup()
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.storage_gc(path)
  select source_path from public.forms where deleted_at<now()-interval '30 days' on conflict do nothing;
  delete from public.forms where deleted_at<now()-interval '30 days';
  delete from public.uploads where expires_at<now()-interval '1 day';
  delete from public.rate_limits where expires_at<now();
end $$;

revoke all on function public.reserve_upload(uuid,uuid,text,bigint),public.register_form(uuid,uuid,jsonb,jsonb,bigint),public.accept_submission(uuid,integer,jsonb,jsonb,uuid,text,text),public.take_rate_limit(text,integer,integer),public.prepare_cleanup() from public,anon,authenticated;
grant execute on function public.reserve_upload(uuid,uuid,text,bigint),public.register_form(uuid,uuid,jsonb,jsonb,bigint),public.accept_submission(uuid,integer,jsonb,jsonb,uuid,text,text),public.take_rate_limit(text,integer,integer),public.prepare_cleanup() to service_role;
