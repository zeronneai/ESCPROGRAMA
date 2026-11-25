-- =============================================================================
-- 0077_conciliacion_plazo.sql   (requiere 0076 ya aplicado)
-- Conciliaciones: plazo de 7 dias, castigo de comision e identificacion por la direccion.
--   * Cada abono tiene 7 dias, desde que se sube, para que un vendedor lo identifique.
--   * Si se identifica DESPUES de los 7 dias ("No identificados", en rojo), la comision de esas
--     facturas baja 10% y se paga hasta la siguiente quincena.
--   * Aplica igual a la jefa de ventas (tambien vende).
--   * La gerente y el CEO ven los pendientes y los no identificados, y pueden identificar un pago a
--     nombre de un vendedor (con usuario) o de alguien sin usuario (escribiendo su nombre).
--   * Aviso en tiempo real: al subir un estado de cuenta, a los vendedores les sale una ventana
--     "Hay pagos por identificar" y despues un aviso fijo mientras haya pendientes.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.conciliacion_movimientos
  add column if not exists tardio boolean not null default false,
  add column if not exists tomado_para text,
  add column if not exists vendedor_id uuid references public.profiles (id);
update public.conciliacion_movimientos set vendedor_id = tomado_por where vendedor_id is null and tomado_por is not null;
alter table public.conciliacion_facturas alter column vendedor_id drop not null;

alter table public.ventas
  add column if not exists comision_descuento_pct numeric(5, 2) not null default 0 check (comision_descuento_pct between 0 and 100),
  add column if not exists comision_quincena date;

-- La gerente y el CEO tambien ven las conciliaciones.
drop policy if exists conciliaciones_select on public.conciliaciones;
drop policy if exists conciliacion_mov_select on public.conciliacion_movimientos;
drop policy if exists conciliacion_fact_select on public.conciliacion_facturas;
create policy conciliaciones_select on public.conciliaciones for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager() or public.is_gerente());
create policy conciliacion_mov_select on public.conciliacion_movimientos for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager() or public.is_gerente());
create policy conciliacion_fact_select on public.conciliacion_facturas for select to authenticated
  using (public.is_finanzas() or public.is_seller() or public.is_sales_manager() or public.is_gerente());
drop policy if exists conciliaciones_storage_select on storage.objects;
create policy conciliaciones_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'conciliaciones' and (public.is_finanzas() or public.is_sales_manager() or public.is_gerente()));

-- Plazo para identificar un abono (7 dias desde que se subio).
create or replace function public.conciliacion_vencido(p_creado timestamptz) returns boolean
language sql stable as $$ select now() > p_creado + interval '7 days'; $$;

-- Inicio de la quincena siguiente a una fecha (quincenas: 1 al 15 y 16 a fin de mes).
create or replace function public.quincena_siguiente(p date) returns date
language sql immutable as $$
  select case when extract(day from p) <= 15 then (date_trunc('month', p) + interval '15 days')::date
              else (date_trunc('month', p) + interval '1 month')::date end;
$$;

-- Liga un pago con su venta y la marca pagada con la fecha del abono.
-- Si el abono se identifico tarde: -10% de comision y se paga la siguiente quincena.
create or replace function public.conciliacion_aplicar(p_fila uuid, p_venta uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f public.conciliacion_facturas; v public.ventas; m public.conciliacion_movimientos;
begin
  select * into f from public.conciliacion_facturas where id = p_fila;
  select * into v from public.ventas where id = p_venta;
  select * into m from public.conciliacion_movimientos where id = f.movimiento_id;
  update public.conciliacion_facturas set venta_id = v.id where id = f.id;
  if m.tardio then
    update public.ventas
       set comision_descuento_pct = 10,
           comision_quincena = public.quincena_siguiente(coalesce(m.tomado_at, now())::date)
     where id = v.id;
  end if;
  if v.porcentaje_cobrado >= 100 then return 'ya_pagada'; end if;
  update public.ventas set porcentaje_cobrado = 100, fecha_cobro = m.fecha where id = v.id;
  update public.conciliacion_facturas set marco_pagada = true where id = f.id;
  return 'pagada';
end $$;
revoke all on function public.conciliacion_aplicar(uuid, uuid) from public, anon, authenticated;

-- Tomar un abono. El vendedor (o la jefa) para si mismo; la jefa, la gerente o el CEO tambien a nombre
-- de un vendedor (p_vendedor) o de alguien sin usuario (p_para = su nombre).
drop function if exists public.conciliacion_tomar(uuid, text[]);
create or replace function public.conciliacion_tomar(p_mov uuid, p_folios text[], p_vendedor uuid default null, p_para text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.conciliacion_movimientos; v_folio text; v_venta uuid; v_fila uuid; v_res text; v_out jsonb := '[]'::jsonb; v_n integer := 0;
  v_vend uuid; v_para text := nullif(left(trim(coalesce(p_para, '')), 80), ''); v_ajeno boolean; v_nombre text;
begin
  v_ajeno := p_vendedor is not null or v_para is not null;
  if v_ajeno then
    if not (public.is_sales_manager() or public.is_gerente()) then
      raise exception 'Solo la jefa de ventas, la gerente o el CEO identifican pagos a nombre de otro' using errcode = '42501';
    end if;
    if p_vendedor is not null then
      if not exists (select 1 from public.profiles where id = p_vendedor and rol in ('vendedor', 'jefe_ventas')) then raise exception 'Vendedor no valido'; end if;
      v_vend := p_vendedor;
      v_para := null;
    end if;
  else
    if not public.is_seller() then raise exception 'Solo los vendedores toman pagos' using errcode = '42501'; end if;
    v_vend := auth.uid();
  end if;

  select * into m from public.conciliacion_movimientos where id = p_mov for update;
  if m.id is null then raise exception 'Pago no encontrado'; end if;
  if m.tomado_por is not null then raise exception 'Este pago ya lo tomo %', coalesce(m.tomado_para, m.tomado_nombre, 'otro vendedor'); end if;

  select nombre into v_nombre from public.profiles where id = v_vend;
  update public.conciliacion_movimientos
     set tomado_por = auth.uid(), tomado_at = now(), vendedor_id = v_vend,
         tomado_nombre = coalesce(v_nombre, v_para), tomado_para = case when v_ajeno then coalesce(v_nombre, v_para) end,
         tardio = public.conciliacion_vencido(created_at)
   where id = m.id
   returning * into m;

  for v_folio in select distinct upper(trim(x)) from unnest(p_folios) x where trim(coalesce(x, '')) <> '' loop
    if length(v_folio) > 40 then raise exception 'Folio invalido'; end if;
    v_n := v_n + 1;
    if v_n > 30 then raise exception 'Demasiadas facturas'; end if;
    v_venta := null;
    if v_vend is not null then
      select id into v_venta from public.ventas
       where vendedor_id = v_vend and upper(trim(factura)) = v_folio and tipo = 'venta' and cancelada_at is null
       order by created_at desc limit 1;
    end if;
    insert into public.conciliacion_facturas (movimiento_id, folio, vendedor_id) values (m.id, v_folio, v_vend) returning id into v_fila;
    if v_venta is null then
      v_res := 'pendiente';
    elsif v_ajeno then
      -- A nombre de otro: si le falta la comision, queda ligada y el vendedor la completa.
      begin
        v_res := public.conciliacion_aplicar(v_fila, v_venta);
      exception when others then
        update public.conciliacion_facturas set venta_id = v_venta where id = v_fila;
        v_res := 'falta_comision';
      end;
    else
      v_res := public.conciliacion_aplicar(v_fila, v_venta);
    end if;
    v_out := v_out || jsonb_build_object('folio', v_folio, 'estado', v_res, 'tardio', m.tardio);
  end loop;
  if v_n = 0 then raise exception 'Escribe la factura que paga este abono'; end if;
  if v_ajeno and v_vend is not null and v_vend <> auth.uid() then
    perform public.notify_user(v_vend, 'conciliacion', 'Identificaron un pago a tu nombre',
      'Abono de ' || m.monto || ' del ' || to_char(m.fecha, 'DD/MM') || ': ' || array_to_string(p_folios, ', '), '/vendedor/conciliaciones', m.id);
  end if;
  return v_out;
end $$;
revoke all on function public.conciliacion_tomar(uuid, text[], uuid, text) from public, anon;
grant execute on function public.conciliacion_tomar(uuid, text[], uuid, text) to authenticated;

-- Soltar: tambien la gerente y el CEO.
create or replace function public.conciliacion_soltar(p_mov uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.conciliacion_movimientos; jefes boolean := public.is_finanzas() or public.is_sales_manager() or public.is_gerente();
begin
  select * into m from public.conciliacion_movimientos where id = p_mov for update;
  if m.id is null then raise exception 'Pago no encontrado'; end if;
  if not (jefes or m.tomado_por = auth.uid()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  if not jefes and exists (select 1 from public.conciliacion_facturas where movimiento_id = m.id and marco_pagada) then
    raise exception 'Ya marco una factura como pagada: para soltarlo, pidele a la jefa de ventas o a finanzas';
  end if;
  delete from public.conciliacion_facturas where movimiento_id = m.id;
  update public.conciliacion_movimientos
     set tomado_por = null, tomado_at = null, tomado_nombre = null, tomado_para = null, vendedor_id = null, tardio = false
   where id = m.id;
end $$;

-- Marcar pagada una factura ligada: el vendedor, la jefa o la direccion.
create or replace function public.conciliacion_marcar_pagada(p_fila uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f public.conciliacion_facturas;
begin
  select * into f from public.conciliacion_facturas where id = p_fila;
  if f.id is null or f.venta_id is null then raise exception 'Primero sube la factura a tu bitacora'; end if;
  if not (f.vendedor_id = auth.uid() or public.is_sales_manager() or public.is_gerente()) then raise exception 'No autorizado' using errcode = '42501'; end if;
  return public.conciliacion_aplicar(f.id, f.venta_id);
end $$;

-- Tiempo real: que el portal se entere en cuanto se suben abonos o alguien los toma.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'conciliacion_movimientos') then
    alter publication supabase_realtime add table public.conciliacion_movimientos;
  end if;
end $$;

commit;
