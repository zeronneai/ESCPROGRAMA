-- Bucket privado para imagenes de referencia.
-- Ruta: {request_id}/{item_id}/{archivo}. El primer segmento es la solicitud.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('references', 'references', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_request_id(p_name text) returns uuid
language sql immutable as $$
  select case when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$'
              then ((storage.foldername(p_name))[1])::uuid end;
$$;

grant execute on function public.storage_request_id(text) to authenticated;

create policy refs_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'references' and public.can_read_request(public.storage_request_id(name)));
create policy refs_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'references' and public.is_own_draft(public.storage_request_id(name)));
create policy refs_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'references' and public.is_own_draft(public.storage_request_id(name)));
