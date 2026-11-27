-- =============================================================================
-- 0095_bitacora_incidencias.sql   (requiere 0021)
-- BITACORA DE INCIDENCIAS (formato ESC-ALM-FR-003)
--  * Solo el supervisor de almacen la llena; la firma es automatica (su nombre).
--  * Incidencia: una de las 5 del formato. "Producto no conforme / danado" pide en que etapa
--    (reciba, almacenamiento o entrega a cliente). Lo demas es abierto.
--  * La consultan la jefa de ventas, la gerente (y CEO), el coordinador ISO y el comprador.
--  * Si en un mismo mes se registran 3 de la misma incidencia, al coordinador ISO le sale un aviso
--    para llenar una acción correctiva (RAC); el aviso se quita cuando la llena.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

create sequence if not exists public.incidencia_seq;
grant usage on sequence public.incidencia_seq to authenticated;
create table if not exists public.incidencias (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique default ('INC-' || lpad(nextval('public.incidencia_seq')::text, 4, '0')),
  fecha date not null default public.local_today(),
  tipo text not null check (tipo in ('devolucion', 'error_carga', 'error_factura', 'incumplimiento_entrega', 'producto_no_conforme')),
  variante text check (variante in ('reciba', 'almacenamiento', 'entrega_cliente')),
  producto text check (length(producto) <= 500),
  cliente text check (length(cliente) <= 300),
  factura text check (length(factura) <= 80),
  accion text check (length(accion) <= 2000),
  firma_id uuid not null default auth.uid() references public.profiles (id),
  firma_nombre text,
  cancelada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tipo = 'producto_no_conforme') = (variante is not null))
);
create index if not exists incidencias_fecha_idx on public.incidencias (fecha desc);
create index if not exists incidencias_tipo_idx on public.incidencias (tipo, fecha);

-- Avisos al coordinador ISO (una por incidencia y mes).
create table if not exists public.incidencias_alertas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  mes date not null,
  n int not null default 3,
  sac_id uuid references public.acciones_correctivas (id),
  atendida_por uuid references public.profiles (id),
  atendida_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tipo, mes)
);

create or replace function public.can_read_incidencias() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role('supervisor_almacen') or public.is_sales_manager() or public.is_gerente() or public.is_iso() or public.is_buyer();
$$;
grant execute on function public.can_read_incidencias() to authenticated;

alter table public.incidencias enable row level security;
alter table public.incidencias_alertas enable row level security;
revoke all on public.incidencias, public.incidencias_alertas from anon, authenticated;
grant select, insert, update on public.incidencias to authenticated;
grant select on public.incidencias_alertas to authenticated;
drop policy if exists incidencias_select on public.incidencias;
create policy incidencias_select on public.incidencias for select to authenticated using (public.can_read_incidencias());
drop policy if exists incidencias_insert on public.incidencias;
create policy incidencias_insert on public.incidencias for insert to authenticated with check (public.has_role('supervisor_almacen'));
drop policy if exists incidencias_update on public.incidencias;
create policy incidencias_update on public.incidencias for update to authenticated
  using (public.has_role('supervisor_almacen')) with check (public.has_role('supervisor_almacen'));
drop policy if exists incidencias_alertas_select on public.incidencias_alertas;
create policy incidencias_alertas_select on public.incidencias_alertas for select to authenticated using (public.can_read_incidencias());

-- Firma automatica y la variante solo para producto no conforme.
create or replace function public.incidencias_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.firma_id := auth.uid();
    new.firma_nombre := public.my_name();
  else
    new.firma_id := old.firma_id;
    new.firma_nombre := old.firma_nombre;
    new.folio := old.folio;
    new.created_at := old.created_at;
  end if;
  if new.tipo <> 'producto_no_conforme' then new.variante := null; end if;
  if new.fecha > public.local_today() then raise exception 'La fecha no puede ser futura'; end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists incidencias_before on public.incidencias;
create trigger incidencias_before before insert or update on public.incidencias for each row execute function public.incidencias_before();
drop trigger if exists incidencias_audit on public.incidencias;
create trigger incidencias_audit after insert or update on public.incidencias for each row execute function public.audit_row();
drop trigger if exists incidencias_no_delete on public.incidencias;
create trigger incidencias_no_delete before delete on public.incidencias for each row execute function public.forbid_mutation();

-- Al llegar a 3 de la misma incidencia en el mes: aviso al coordinador ISO.
create or replace function public.incidencias_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_mes date := date_trunc('month', new.fecha)::date;
  v_n int;
  v_id uuid;
  v_nombre text := case new.tipo when 'devolucion' then 'Devolución' when 'error_carga' then 'Error de carga'
    when 'error_factura' then 'Error de factura' when 'incumplimiento_entrega' then 'Incumplimiento de entrega' else 'Producto no conforme / dañado' end;
begin
  if new.cancelada_at is not null then return null; end if;
  select count(*)::int into v_n from public.incidencias i
   where i.tipo = new.tipo and i.cancelada_at is null and i.fecha >= v_mes and i.fecha < (v_mes + interval '1 month');
  if v_n >= 3 then
    insert into public.incidencias_alertas (tipo, mes, n) values (new.tipo, v_mes, v_n)
    on conflict (tipo, mes) do update set n = excluded.n
    returning id into v_id;
    if v_n = 3 then
      perform public.notify_role('coordinador_iso', 'incidencia_rac', 'Tercera incidencia: ' || v_nombre,
        format('Ya van %s en %s. Llena una acción correctiva (RAC).', v_n, to_char(v_mes, 'MM/YYYY')), '/incidencias', v_id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists incidencias_after on public.incidencias;
create trigger incidencias_after after insert or update of tipo, fecha, cancelada_at on public.incidencias for each row execute function public.incidencias_after();

-- El coordinador ISO liga la RAC que lleno (y el aviso se quita).
create or replace function public.incidencia_alerta_ligar(p_alerta uuid, p_sac uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_iso() then raise exception 'Solo el coordinador ISO' using errcode = '42501'; end if;
  if not exists (select 1 from public.acciones_correctivas where id = p_sac) then raise exception 'Acción correctiva inválida'; end if;
  update public.incidencias_alertas set sac_id = p_sac, atendida_por = auth.uid(), atendida_at = now() where id = p_alerta and sac_id is null;
end;
$$;
revoke all on function public.incidencia_alerta_ligar(uuid, uuid) from public, anon;
grant execute on function public.incidencia_alerta_ligar(uuid, uuid) to authenticated;

commit;
