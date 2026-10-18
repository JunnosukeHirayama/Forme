-- No browser SELECT/INSERT/UPDATE/DELETE policies are granted on this bucket.
-- Only short-lived signed capabilities, issued after server-side authorization, can access files.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('forme-private','forme-private',false,20971520,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
