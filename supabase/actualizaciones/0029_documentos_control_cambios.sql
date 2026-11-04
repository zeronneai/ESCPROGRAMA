-- =============================================================================
-- 0029_documentos_control_cambios.sql   (requiere 0028 ya aplicado)
-- Que hace:
--   * DOCUMENTOS: base de documentos del sistema de calidad (politica de calidad, valores, manual,
--     procedimientos, formatos...). Solo el Coordinador ISO los sube (PDF, titulo, codigo, categoria y
--     version). Todos los usuarios los pueden consultar y descargar. Una version nueva reemplaza a la
--     anterior y la anterior queda en el historial (no se borra nada).
--   * CONTROL DE CAMBIOS: registro de cambios a documentos o procesos. Solo el Coordinador ISO lo llena;
--     la Gerente y el Comprador lo consultan (les llega aviso de cada cambio nuevo). Es una version base:
--     cuando ESC tenga su formato se ajustan los campos.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Documentos
-- ---------------------------------------------------------------------------
create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  codigo text check (codigo is null or length(trim(codigo)) between 2 and 40),
  titulo text not null check (length(trim(titulo)) between 2 and 200),
  categoria text not null default 'Otro' check (categoria in ('Política', 'Valores', 'Manual', 'Procedimiento', 'Instructivo',
                                                              'Formato', 'Organigrama', 'Registro', 'Otro')),
  version text not null default '01' check (length(trim(version)) between 1 and 20),
  fecha_emision date not null default public.local_today(),
  descripcion text check (descripcion is null or length(descripcion) <= 1000),
  path text not null,
  nombre_archivo text not null,
  tamano integer,
  vigente boolean not null default true,
  reemplaza_id uuid references public.documentos (id),
  baja_at timestamptz,
  baja_motivo text check (baja_motivo is null or length(baja_motivo) <= 300),
  created_by uuid not null default auth.uid() references public.profiles (id),
  autor_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documentos_vigente_idx on public.documentos (vigente, categoria, titulo);
create index documentos_reemplaza_idx on public.documentos (reemplaza_id) where reemplaza_id is not null;

create trigger documentos_autor before insert on public.documentos for each row execute function public.set_autor();
create trigger documentos_updated before update on public.documentos for each row execute function public.set_updated_at();
create trigger documentos_audit after insert or update on public.documentos for each row execute function public.audit_row();
create trigger documentos_no_delete before delete on public.documentos for each row execute function public.forbid_mutation();

-- Al subir una version nueva, la anterior deja de estar vigente.
create or replace function public.documentos_reemplazo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reemplaza_id is not null then
    update public.documentos set vigente = false where id = new.reemplaza_id and vigente;
  end if;
  return null;
end $$;
create trigger documentos_reemplazo after insert on public.documentos for each row execute function public.documentos_reemplazo();
revoke all on function public.documentos_reemplazo() from public, anon, authenticated;

alter table public.documentos enable row level security;
revoke all on public.documentos from anon, authenticated;
grant select on public.documentos to authenticated;
grant insert (codigo, titulo, categoria, version, fecha_emision, descripcion, path, nombre_archivo, tamano, reemplaza_id) on public.documentos to authenticated;
grant update (codigo, titulo, categoria, version, fecha_emision, descripcion, vigente, baja_at, baja_motivo) on public.documentos to authenticated;
create policy documentos_select on public.documentos for select to authenticated using (public.is_active_user());
create policy documentos_insert on public.documentos for insert to authenticated with check (public.is_iso());
create policy documentos_update on public.documentos for update to authenticated using (public.is_iso()) with check (public.is_iso());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy documentos_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.is_active_user());
create policy documentos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and public.is_iso());

-- ---------------------------------------------------------------------------
-- 2) Control de cambios
-- ---------------------------------------------------------------------------
create sequence public.control_cambios_seq;
create table public.control_cambios (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique default ('CC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.control_cambios_seq')::text, 3, '0')),
  fecha date not null default public.local_today(),
  tipo text not null default 'modificacion' check (tipo in ('alta', 'modificacion', 'baja')),
  documento_id uuid references public.documentos (id),
  documento_texto text check (documento_texto is null or length(documento_texto) <= 200),
  area text check (area is null or length(area) <= 120),
  descripcion text not null check (length(trim(descripcion)) between 3 and 3000),
  motivo text not null check (length(trim(motivo)) between 3 and 2000),
  version_anterior text check (version_anterior is null or length(version_anterior) <= 20),
  version_nueva text check (version_nueva is null or length(version_nueva) <= 20),
  solicitado_por text check (solicitado_por is null or length(solicitado_por) <= 150),
  aprobado_por text check (aprobado_por is null or length(aprobado_por) <= 150),
  fecha_implementacion date,
  estado text not null default 'en_proceso' check (estado in ('en_proceso', 'implementado', 'cancelado')),
  notas text check (notas is null or length(notas) <= 2000),
  created_by uuid not null default auth.uid() references public.profiles (id),
  autor_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_cambios_documento check (documento_id is not null or documento_texto is not null)
);
create index control_cambios_fecha_idx on public.control_cambios (fecha desc);

create trigger control_cambios_autor before insert on public.control_cambios for each row execute function public.set_autor();
create trigger control_cambios_updated before update on public.control_cambios for each row execute function public.set_updated_at();
create trigger control_cambios_audit after insert or update on public.control_cambios for each row execute function public.audit_row();
create trigger control_cambios_no_delete before delete on public.control_cambios for each row execute function public.forbid_mutation();

-- Aviso a la Gerente y al Comprador de cada cambio nuevo.
create or replace function public.control_cambios_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_doc text;
begin
  select coalesce(d.codigo || ' ', '') || d.titulo into v_doc from public.documentos d where d.id = new.documento_id;
  v_doc := coalesce(v_doc, new.documento_texto);
  perform public.notify_role('gerente', 'control_cambio', 'Control de cambios ' || new.numero || ': ' || v_doc,
    left(new.descripcion, 200), '/calidad/cambios/' || new.id, new.id);
  perform public.notify_role('comprador', 'control_cambio', 'Control de cambios ' || new.numero || ': ' || v_doc,
    left(new.descripcion, 200), '/calidad/cambios/' || new.id, new.id);
  return null;
end $$;
create trigger control_cambios_aviso after insert on public.control_cambios for each row execute function public.control_cambios_aviso();
revoke all on function public.control_cambios_aviso() from public, anon, authenticated;

alter table public.control_cambios enable row level security;
revoke all on public.control_cambios from anon, authenticated;
grant usage on sequence public.control_cambios_seq to authenticated;
grant select on public.control_cambios to authenticated;
grant insert (fecha, tipo, documento_id, documento_texto, area, descripcion, motivo, version_anterior, version_nueva, solicitado_por,
              aprobado_por, fecha_implementacion, estado, notas) on public.control_cambios to authenticated;
grant update (fecha, tipo, documento_id, documento_texto, area, descripcion, motivo, version_anterior, version_nueva, solicitado_por,
              aprobado_por, fecha_implementacion, estado, notas) on public.control_cambios to authenticated;
create policy control_cambios_select on public.control_cambios for select to authenticated
  using (public.is_iso() or public.is_gerente() or public.is_buyer());
create policy control_cambios_insert on public.control_cambios for insert to authenticated with check (public.is_iso());
create policy control_cambios_update on public.control_cambios for update to authenticated using (public.is_iso()) with check (public.is_iso());

commit;

-- VERIFICACION:
--   select id from storage.buckets where id = 'documentos';   -- 1 fila
--   select count(*) from public.control_cambios;              -- 0
