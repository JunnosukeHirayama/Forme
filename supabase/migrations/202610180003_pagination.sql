-- Bound JSON payloads for Vercel Functions. A page has at most ten answer snapshots.
create function public.list_submissions(p_owner uuid,p_form uuid default null,p_page integer default 0,p_search text default '',p_before timestamptz default now())
returns jsonb language sql stable security definer set search_path='' as $$
  with visible as (
    select s.* from public.submissions s join public.forms f on f.id=s.form_id
    where s.submitted_at<=p_before and f.owner_id=p_owner and f.deleted_at is null and (p_form is null or f.id=p_form)
      and (p_search='' or position(lower(left(p_search,160)) in lower(s.answers::text))>0 or position(lower(left(p_search,160)) in s.id::text)>0)
  ), page as (
    select * from visible order by submitted_at desc,id limit 10 offset greatest(0,p_page)*10
  )
  select jsonb_build_object('total',(select count(*) from visible),'page',greatest(0,p_page),'pageSize',10,'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'formId',form_id,'title',definition->>'title','values',answers,'definition',definition,'submittedAt',submitted_at,'version',version
  ) order by submitted_at desc,id) from page),'[]'::jsonb));
$$;
revoke all on function public.list_submissions(uuid,uuid,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.list_submissions(uuid,uuid,integer,text,timestamptz) to service_role;
