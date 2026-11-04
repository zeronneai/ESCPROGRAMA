-- =============================================================================
-- 0031_pagos_extranjeros.sql   (requiere 0030_rol_ceo.sql YA aplicado, en su propia ejecucion)
-- Que hace:
--   * PAGOS A PROVEEDORES EXTRANJEROS entre el Comprador y el CEO:
--     - El comprador elige que proveedores entran a esta seccion y registra cada orden de compra (OC)
--       con sus facturas o anticipos (numero, fecha, monto y fecha limite). Todo se puede completar
--       despues: la factura y el monto llegan cuando el proveedor envia.
--     - El comprador pone el estatus: Por liberar, En espera o Liberado (listo para pagar). Al liberar le
--       llega aviso al CEO.
--     - El CEO marca Pagado (fecha, monto, referencia) y sube el comprobante (PDF o imagen). Le llega
--       aviso al comprador.
--     - Cuando el comprador descarga el comprobante (o lo archiva), el pago pasa al historial y deja
--       de aparecer como pendiente. Nada se borra.
--   * El CEO tambien puede hacer minutas.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run (una sola ejecucion).
-- =============================================================================

begin;

create or replace function public.is_ceo() returns boolean
language sql stable security definer set search_path = public as $$ select public.has_role('ceo'); $$;
grant execute on function public.is_ceo() to authenticated;

create or replace function public.is_jefe_depto() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and activo and not must_change_password
                  and rol in ('jefe_ventas', 'gerente', 'comprador', 'supervisor_almacen', 'supervisor_finanzas', 'ceo'));
$$;

-- ---------------------------------------------------------------------------
-- 1) Proveedores que entran a la seccion de pagos
-- ---------------------------------------------------------------------------
alter table public.suppliers
  add column en_pagos boolean not null default false,
  add column pagos_moneda text not null default 'USD' check (pagos_moneda in ('USD', 'MXN', 'CNY', 'EUR'));
grant update (en_pagos, pagos_moneda) on public.suppliers to authenticated;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using (public.is_buyer() or public.is_almacen() or public.is_gerente() or public.is_iso() or (public.is_ceo() and en_pagos));

-- ---------------------------------------------------------------------------
-- 2) Ordenes de compra y sus pagos (anticipos o facturas)
-- ---------------------------------------------------------------------------
create table public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  numero text not null check (length(trim(numero)) between 1 and 60),
  fecha date not null default public.local_today(),
  moneda text not null default 'USD' check (moneda in ('USD', 'MXN', 'CNY', 'EUR')),
  monto numeric(14, 2) check (monto is null or monto > 0),
  descripcion text check (descripcion is null or length(descripcion) <= 1000),
  cerrada_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index ordenes_compra_numero_key on public.ordenes_compra (supplier_id, lower(trim(numero)));
create index ordenes_compra_supplier_idx on public.ordenes_compra (supplier_id, fecha desc);

create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  oc_id uuid not null references public.ordenes_compra (id),
  tipo text not null default 'factura' check (tipo in ('anticipo', 'factura')),
  numero_factura text check (numero_factura is null or length(numero_factura) <= 60),
  fecha_factura date,
  monto numeric(14, 2) check (monto is null or monto > 0),
  fecha_limite date,
  notas text check (notas is null or length(notas) <= 1000),
  estado text not null default 'por_liberar' check (estado in ('por_liberar', 'en_espera', 'liberado', 'pagado', 'cerrado')),
  estado_nota text check (estado_nota is null or length(estado_nota) <= 300),
  factura_path text,
  factura_nombre text,
  liberado_at timestamptz,
  liberado_por uuid references public.profiles (id),
  pago_fecha date,
  pago_monto numeric(14, 2),
  pago_referencia text check (pago_referencia is null or length(pago_referencia) <= 120),
  pago_notas text check (pago_notas is null or length(pago_notas) <= 500),
  comprobante_path text,
  comprobante_nombre text,
  pagado_at timestamptz,
  pagado_por uuid references public.profiles (id),
  pagado_nombre text,
  cerrado_at timestamptz,
  cerrado_por uuid references public.profiles (id),
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pagos_oc_idx on public.pagos (oc_id);
create index pagos_estado_idx on public.pagos (estado) where estado <> 'cerrado';

create trigger ordenes_compra_updated before update on public.ordenes_compra for each row execute function public.set_updated_at();
create trigger ordenes_compra_audit after insert or update or delete on public.ordenes_compra for each row execute function public.audit_row();
create trigger pagos_updated before update on public.pagos for each row execute function public.set_updated_at();
create trigger pagos_audit after insert or update or delete on public.pagos for each row execute function public.audit_row();

-- El estatus solo cambia con las funciones de abajo; un pago hecho ya no cambia de monto.
create or replace function public.pagos_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('esc.pago_rpc', true) = '1' then return new; end if;
  if TG_OP = 'INSERT' then
    new.estado := 'por_liberar';
    new.created_by := auth.uid();
    return new;
  end if;
  if new.estado is distinct from old.estado then raise exception 'El estatus se cambia con los botones del portal'; end if;
  if old.estado in ('pagado', 'cerrado') and new.monto is distinct from old.monto then
    raise exception 'Este pago ya se hizo: el monto ya no se puede cambiar';
  end if;
  return new;
end $$;
create trigger pagos_before before insert or update on public.pagos for each row execute function public.pagos_before();
revoke all on function public.pagos_before() from public, anon, authenticated;

-- La OC y sus pagos solo se borran si nada se ha liberado ni pagado.
create or replace function public.pagos_before_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.estado not in ('por_liberar', 'en_espera') then raise exception 'Solo se borran pagos que no se han liberado'; end if;
  return old;
end $$;
create trigger pagos_before_delete before delete on public.pagos for each row execute function public.pagos_before_delete();
revoke all on function public.pagos_before_delete() from public, anon, authenticated;

alter table public.ordenes_compra enable row level security;
alter table public.pagos enable row level security;
revoke all on public.ordenes_compra, public.pagos from anon, authenticated;
grant select on public.ordenes_compra, public.pagos to authenticated;
grant insert (id, supplier_id, numero, fecha, moneda, monto, descripcion) on public.ordenes_compra to authenticated;
grant update (numero, fecha, moneda, monto, descripcion, cerrada_at) on public.ordenes_compra to authenticated;
grant delete on public.ordenes_compra to authenticated;
grant insert (id, oc_id, tipo, numero_factura, fecha_factura, monto, fecha_limite, notas, factura_path, factura_nombre) on public.pagos to authenticated;
grant update (tipo, numero_factura, fecha_factura, monto, fecha_limite, notas, factura_path, factura_nombre) on public.pagos to authenticated;
grant delete on public.pagos to authenticated;

create policy ordenes_compra_select on public.ordenes_compra for select to authenticated using (public.is_buyer() or public.is_ceo());
create policy ordenes_compra_insert on public.ordenes_compra for insert to authenticated
  with check (public.is_buyer() and exists (select 1 from public.suppliers s where s.id = ordenes_compra.supplier_id and s.en_pagos));
create policy ordenes_compra_update on public.ordenes_compra for update to authenticated using (public.is_buyer()) with check (public.is_buyer());
create policy ordenes_compra_delete on public.ordenes_compra for delete to authenticated
  using (public.is_buyer() and not exists (select 1 from public.pagos p where p.oc_id = ordenes_compra.id));
create policy pagos_select on public.pagos for select to authenticated using (public.is_buyer() or public.is_ceo());
create policy pagos_insert on public.pagos for insert to authenticated with check (public.is_buyer());
create policy pagos_update on public.pagos for update to authenticated using (public.is_buyer()) with check (public.is_buyer());
create policy pagos_delete on public.pagos for delete to authenticated using (public.is_buyer());

-- Texto corto para los avisos: "Proveedor · OC 123 · Factura A-1 · 1,500.00 USD".
create or replace function public.pago_titulo(p public.pagos) returns text
language sql stable security definer set search_path = public as $$
  select s.nombre || ' · OC ' || o.numero
         || case when p.numero_factura is not null then ' · ' || case p.tipo when 'anticipo' then 'Anticipo ' else 'Factura ' end || p.numero_factura
                 when p.tipo = 'anticipo' then ' · Anticipo' else '' end
         || coalesce(' · ' || to_char(p.monto, 'FM999,999,999,990.00') || ' ' || o.moneda, '')
    from public.ordenes_compra o join public.suppliers s on s.id = o.supplier_id
   where o.id = p.oc_id;
$$;
revoke all on function public.pago_titulo(public.pagos) from public, anon, authenticated;

-- Comprador: Por liberar, En espera o Liberado (listo para que el CEO pague).
create or replace function public.pago_estado(p_id uuid, p_estado text, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pagos;
begin
  if not public.is_buyer() then raise exception 'Solo el comprador cambia el estatus' using errcode = '42501'; end if;
  if p_estado not in ('por_liberar', 'en_espera', 'liberado') then raise exception 'Estatus invalido'; end if;
  select * into p from public.pagos where id = p_id for update;
  if p.id is null then raise exception 'No encontrado'; end if;
  if p.estado in ('pagado', 'cerrado') then raise exception 'Este pago ya se hizo'; end if;
  if p_estado = 'liberado' and coalesce(p.monto, 0) <= 0 then raise exception 'Escribe el monto antes de liberar el pago'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos
     set estado = p_estado, estado_nota = nullif(left(trim(coalesce(p_nota, '')), 300), ''),
         liberado_at = case when p_estado = 'liberado' then now() else null end,
         liberado_por = case when p_estado = 'liberado' then auth.uid() else null end
   where id = p_id
   returning * into p;
  perform set_config('esc.pago_rpc', '', true);
  if p_estado = 'liberado' then
    perform public.notify_role('ceo', 'pago_liberado', 'Pago por hacer: ' || public.pago_titulo(p),
      coalesce('Fecha limite ' || to_char(p.fecha_limite, 'DD/MM/YYYY'), 'Liberado por compras'), '/pagos/oc/' || p.oc_id, p.id);
  end if;
end $$;

-- CEO: marcar pagado con su comprobante.
create or replace function public.pago_marcar_pagado(p_id uuid, p_fecha date, p_monto numeric, p_referencia text default null,
                                                     p_notas text default null, p_path text default null, p_nombre text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pagos;
begin
  if not public.is_ceo() then raise exception 'Solo el CEO marca los pagos' using errcode = '42501'; end if;
  select * into p from public.pagos where id = p_id for update;
  if p.id is null then raise exception 'No encontrado'; end if;
  if p.estado in ('pagado', 'cerrado') then raise exception 'Ya estaba marcado como pagado'; end if;
  if p_fecha is null then raise exception 'Escribe la fecha del pago'; end if;
  if coalesce(p_monto, p.monto, 0) <= 0 then raise exception 'Escribe el monto pagado'; end if;
  if p_path is not null and p_path not like p_id::text || '/%' then raise exception 'Archivo invalido'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos
     set estado = 'pagado', pago_fecha = p_fecha, pago_monto = coalesce(p_monto, p.monto),
         pago_referencia = nullif(left(trim(coalesce(p_referencia, '')), 120), ''),
         pago_notas = nullif(left(trim(coalesce(p_notas, '')), 500), ''),
         comprobante_path = p_path, comprobante_nombre = case when p_path is null then null else left(coalesce(p_nombre, 'comprobante'), 200) end,
         pagado_at = now(), pagado_por = auth.uid(), pagado_nombre = public.my_name()
   where id = p_id
   returning * into p;
  perform set_config('esc.pago_rpc', '', true);
  perform public.notify_role('comprador', 'pago_hecho', 'Pagado: ' || public.pago_titulo(p),
    case when p.comprobante_path is null then 'El CEO lo marco como pagado (sin comprobante todavia)' else 'Descarga el comprobante para mandarlo al proveedor' end,
    '/pagos/oc/' || p.oc_id, p.id);
end $$;

-- CEO: subir o cambiar el comprobante de un pago ya hecho.
create or replace function public.pago_comprobante(p_id uuid, p_path text, p_nombre text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pagos;
begin
  if not public.is_ceo() then raise exception 'Solo el CEO sube comprobantes' using errcode = '42501'; end if;
  if p_path is null or p_path not like p_id::text || '/%' then raise exception 'Archivo invalido'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos set comprobante_path = p_path, comprobante_nombre = left(coalesce(p_nombre, 'comprobante'), 200),
         estado = case when estado = 'cerrado' then 'pagado' else estado end, cerrado_at = null, cerrado_por = null
   where id = p_id and estado in ('pagado', 'cerrado')
   returning * into p;
  perform set_config('esc.pago_rpc', '', true);
  if p.id is null then raise exception 'Primero marca el pago como hecho'; end if;
  perform public.notify_role('comprador', 'pago_hecho', 'Comprobante listo: ' || public.pago_titulo(p),
    'Descarga el comprobante para mandarlo al proveedor', '/pagos/oc/' || p.oc_id, p.id);
end $$;

-- CEO: deshacer un pago marcado por error (mientras el comprador no lo haya archivado).
create or replace function public.pago_deshacer(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_ceo() then raise exception 'No autorizado' using errcode = '42501'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos
     set estado = 'liberado', pago_fecha = null, pago_monto = null, pago_referencia = null, pago_notas = null,
         comprobante_path = null, comprobante_nombre = null, pagado_at = null, pagado_por = null, pagado_nombre = null
   where id = p_id and estado = 'pagado';
  if not found then raise exception 'Solo se deshace un pago que el comprador aun no archiva'; end if;
  perform set_config('esc.pago_rpc', '', true);
end $$;

-- Comprador: al descargar el comprobante (o archivarlo) el pago pasa al historial.
create or replace function public.pago_cerrar(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_buyer() then raise exception 'No autorizado' using errcode = '42501'; end if;
  perform set_config('esc.pago_rpc', '1', true);
  update public.pagos set estado = 'cerrado', cerrado_at = now(), cerrado_por = auth.uid() where id = p_id and estado = 'pagado';
  perform set_config('esc.pago_rpc', '', true);
end $$;

-- Tarea diaria: recuerda al CEO los pagos liberados que vencen en 2 dias o menos.
create or replace function public.pagos_recordatorio() returns integer
language plpgsql security definer set search_path = public as $$
declare r public.pagos; n integer := 0;
begin
  for r in select * from public.pagos where estado = 'liberado' and fecha_limite is not null and fecha_limite <= public.local_today() + 2 loop
    insert into public.notifications (user_id, tipo, titulo, cuerpo, link, ref_id)
    select pr.id, 'pago_por_vencer',
           case when r.fecha_limite < public.local_today() then 'Pago vencido: ' else 'Pago por vencer: ' end || public.pago_titulo(r),
           'Fecha limite ' || to_char(r.fecha_limite, 'DD/MM/YYYY'), '/pagos/oc/' || r.oc_id, r.id
      from public.profiles pr where pr.rol = 'ceo' and pr.activo;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.pagos_recordatorio() from public, anon, authenticated;
grant execute on function public.pagos_recordatorio() to service_role;

revoke all on function public.pago_estado(uuid, text, text), public.pago_marcar_pagado(uuid, date, numeric, text, text, text, text),
  public.pago_comprobante(uuid, text, text), public.pago_deshacer(uuid), public.pago_cerrar(uuid) from public, anon;
grant execute on function public.pago_estado(uuid, text, text), public.pago_marcar_pagado(uuid, date, numeric, text, text, text, text),
  public.pago_comprobante(uuid, text, text), public.pago_deshacer(uuid), public.pago_cerrar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Archivos: factura (comprador) y comprobante de pago (CEO). La ruta empieza con el id del pago.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos', 'pagos', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy pagos_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'pagos' and (public.is_buyer() or public.is_ceo()));
create policy pagos_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pagos' and (public.is_buyer() or public.is_ceo())
              and exists (select 1 from public.pagos p where p.id = public.storage_first_uuid(name)));

commit;

-- VERIFICACION:
--   select id from storage.buckets where id = 'pagos';   -- 1 fila
