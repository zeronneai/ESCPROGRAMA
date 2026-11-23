-- =============================================================================
-- 0075_envio_en_comision.sql   (requiere 0074 ya aplicado)
-- Envio incluido en los articulos: a veces el envio no viene como renglon aparte ("servicios
-- diversos", que lleva 0%), sino metido en el precio de los articulos. El vendedor dice cuanto
-- envio va incluido (en el total, repartido entre los articulos, o por articulo) y la comision
-- se calcula sobre el importe menos el envio:  comision = (importe - envio) x %.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.venta_lineas add column if not exists envio numeric(14, 2) check (envio is null or envio >= 0);
alter table public.venta_lineas drop column if exists comision;
alter table public.venta_lineas
  add column comision numeric(14, 2) generated always as (round(greatest(importe - coalesce(envio, 0), 0) * comision_pct / 100, 2)) stored;

-- La factura guarda tambien el envio incluido de cada articulo.
create or replace function public.venta_desde_factura(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_folio text := upper(trim(coalesce(p ->> 'folio', '')));
  v_uuid text := nullif(upper(trim(coalesce(p ->> 'uuid', ''))), '');
  v_rfc text := nullif(upper(regexp_replace(coalesce(p ->> 'rfc', ''), '[\s.-]', '', 'g')), '');
  v_razon text := nullif(left(trim(coalesce(p ->> 'razon_social', '')), 200), '');
  v_nombre text := nullif(left(trim(coalesce(p ->> 'nombre', '')), 200), '');
  v_dir text := nullif(left(trim(coalesce(p ->> 'direccion', '')), 300), '');
  v_tel text := nullif(left(trim(coalesce(p ->> 'telefono', '')), 40), '');
  v_pago text := case when p ->> 'pago' = 'credito' then 'credito' else 'contado' end;
  v_dias integer := nullif(p ->> 'dias_credito', '')::integer;
  v_fecha date := coalesce(nullif(p ->> 'fecha', '')::date, public.local_today());
  v_lineas jsonb := coalesce(p -> 'lineas', '[]'::jsonb);
  v_ent_nombre text := nullif(left(trim(coalesce(p ->> 'entrega_nombre', '')), 80), '');
  v_ent_dir text := nullif(left(trim(coalesce(p ->> 'entrega_direccion', '')), 300), '');
  v_elegido boolean := nullif(p ->> 'customer_id', '') is not null;
  v_matriz uuid; v_suc uuid; v_suc_nueva boolean := false;
  v_usado jsonb; v_cust uuid; v_nuevo boolean := false; v_venta uuid; v_salida uuid; v_catalogo boolean; l jsonb; v_clave text;
begin
  if not public.is_seller() then raise exception 'Las ventas las registran los vendedores' using errcode = '42501'; end if;
  if v_folio = '' then raise exception 'Falta el folio de la factura'; end if;
  if jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then raise exception 'La factura no tiene articulos'; end if;
  if v_fecha > public.local_today() then raise exception 'La fecha de la factura no puede ser futura'; end if;
  v_usado := public.salida_folio_usado(v_folio);
  if v_usado is not null then
    raise exception '%', 'La factura ' || (v_usado ->> 'folio') || ' ya se subio el ' || (v_usado ->> 'fecha') || ' por '
      || coalesce(v_usado ->> 'subio', '?') || ' (' || (v_usado ->> 'estado_txt') || '). No se puede subir dos veces.';
  end if;
  if v_uuid is not null and exists (select 1 from public.ventas where upper(factura_uuid) = v_uuid and cancelada_at is null) then
    raise exception 'Esa factura (folio fiscal %) ya esta registrada', v_uuid;
  end if;
  if v_rfc is not null and not public.rfc_valido(v_rfc) then v_rfc := null; end if;
  if v_tel is not null and length(regexp_replace(v_tel, '\D', '', 'g')) < 7 then v_tel := null; end if;

  -- Cliente: el que eligio el vendedor, o el de la factura (RFC o nombre), o uno nuevo.
  if nullif(p ->> 'customer_id', '') is not null then
    select id into v_cust from public.customers where id = (p ->> 'customer_id')::uuid and activo;
    if v_cust is null then raise exception 'Cliente no encontrado'; end if;
  else
    v_cust := public.cliente_de_factura(v_rfc, v_nombre, v_razon);
  end if;
  if v_cust is not null then
    -- Se completan los datos que le falten (no se pisa lo que ya tiene).
    update public.customers
       set razon_social = coalesce(razon_social, v_razon),
           rfc = coalesce(rfc, case when v_rfc in ('XAXX010101000', 'XEXX010101000') then null else v_rfc end),
           direccion = coalesce(direccion, v_dir),
           contacto_telefono = coalesce(contacto_telefono, v_tel)
     where id = v_cust
       and (razon_social is null or rfc is null or direccion is null or contacto_telefono is null);
  else
    if coalesce(v_nombre, v_razon) is null then raise exception 'Falta el nombre del cliente'; end if;
    insert into public.customers (nombre, tipo, razon_social, rfc, direccion, contacto_telefono, created_by)
    values (coalesce(v_nombre, v_razon), 'cliente', v_razon,
            case when v_rfc in ('XAXX010101000', 'XEXX010101000') then null else v_rfc end, v_dir, v_tel, auth.uid())
    returning id into v_cust;
    v_nuevo := true;
  end if;

  -- Domicilio de entrega distinto al fiscal: va como SUCURSAL del cliente (se busca o se crea).
  if v_ent_dir is not null then
    select coalesce(parent_id, id) into v_matriz from public.customers where id = v_cust;
    if v_elegido and exists (select 1 from public.customers where id = v_cust and parent_id is not null) then
      v_suc := v_cust;  -- el vendedor ya eligio la sucursal
    else
      select id into v_suc from public.customers
       where parent_id = v_matriz and activo
         and (lower(coalesce(direccion, '')) = lower(v_ent_dir)
              or (v_ent_nombre is not null and lower(sucursal) = lower(v_ent_nombre)))
       order by (lower(coalesce(direccion, '')) = lower(v_ent_dir)) desc, created_at limit 1;
      if v_suc is null then
        insert into public.customers (parent_id, sucursal, nombre, direccion, contacto_telefono, created_by)
        values (v_matriz, coalesce(v_ent_nombre, left('Entrega ' || v_ent_dir, 80)), 'sucursal', v_ent_dir, v_tel, auth.uid())
        returning id into v_suc;
        v_suc_nueva := true;
      end if;
    end if;
    v_cust := v_suc;
  end if;

  -- Almacen: solo si esta conectado (Configuracion) y hay articulos del catalogo que cargar.
  select exists (
    select 1 from jsonb_array_elements(v_lineas) x
      join public.articulos a on upper(a.clave) = upper(trim(coalesce(x ->> 'clave', '')))
  ) into v_catalogo;
  if v_catalogo and public.almacen_ventas_activo() then
    v_salida := public.salida_crear(v_folio, v_fecha,
      coalesce((select nombre from public.customers where id = v_cust), v_nombre, v_razon),
      nullif(p ->> 'vendedor_factura', ''), nullif(p ->> 'notas_almacen', ''),
      nullif(p ->> 'pdf_path', ''), nullif(p ->> 'pdf_nombre', ''), nullif(p ->> 'xml_path', ''), v_lineas);
  end if;

  insert into public.ventas (customer_id, fecha, factura, monto, moneda, pago, dias_credito, entregado, porcentaje_cobrado,
                             comentarios, origen, factura_uuid, factura_path, factura_nombre, xml_path, pedido)
  values (v_cust, v_fecha, v_folio, nullif(p ->> 'total', '')::numeric,
          case when p ->> 'moneda' = 'USD' then 'USD' else 'MXN' end::public.currency,
          v_pago, case when v_pago = 'credito' then case when v_dias between 1 and 365 then v_dias else 30 end end, false, 0,
          nullif(left(trim(coalesce(p ->> 'comentarios', '')), 2000), ''), 'factura', v_uuid,
          nullif(p ->> 'pdf_path', ''), left(nullif(p ->> 'pdf_nombre', ''), 200), nullif(p ->> 'xml_path', ''),
          nullif(left(trim(coalesce(p ->> 'pedido', '')), 80), ''))
  returning id into v_venta;

  for l in select * from jsonb_array_elements(v_lineas) loop
    v_clave := nullif(upper(trim(coalesce(l ->> 'clave', ''))), '');
    insert into public.venta_lineas (venta_id, articulo_id, descripcion, cantidad, importe, comision_pct, envio)
    values (v_venta, (select id from public.articulos where upper(clave) = v_clave limit 1),
            left(coalesce(nullif(trim(coalesce(l ->> 'descripcion', '')), ''), v_clave, 'Partida'), 300),
            nullif(l ->> 'cantidad', '')::numeric,
            case when coalesce(nullif(l ->> 'importe', '')::numeric, -1) >= 0 then round((l ->> 'importe')::numeric, 2) end,
            case when coalesce(nullif(l ->> 'comision_pct', '')::numeric, -1) between 0 and 100 then round((l ->> 'comision_pct')::numeric, 2) end,
            case when coalesce(nullif(l ->> 'envio', '')::numeric, 0) > 0
                  and (l ->> 'envio')::numeric <= coalesce(nullif(l ->> 'importe', '')::numeric, 0)
                 then round((l ->> 'envio')::numeric, 2) end);
  end loop;

  if v_salida is not null then update public.salidas set venta_id = v_venta where id = v_salida; end if;
  return jsonb_build_object('venta_id', v_venta, 'salida_id', v_salida, 'customer_id', v_cust, 'cliente_nuevo', v_nuevo,
                            'sucursal_id', v_suc, 'sucursal_nueva', v_suc_nueva);
end $$;

create or replace function public.venta_comisiones(p_venta uuid, p_lineas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.ventas; l jsonb; x public.venta_lineas; v_imp numeric; v_pct numeric; v_env numeric; jefa boolean := public.is_sales_manager();
begin
  select * into v from public.ventas where id = p_venta;
  if v.id is null then raise exception 'Venta no encontrada'; end if;
  if not (jefa or (v.vendedor_id = auth.uid() and public.is_seller())) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if v.cancelada_at is not null then raise exception 'La venta esta cancelada'; end if;
  if not jefa and v.comision_revisada_at is not null then
    raise exception 'La jefa de ventas ya reviso esta comision: si algo esta mal, avisale a ella';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' then raise exception 'Datos invalidos'; end if;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_imp := nullif(l ->> 'importe', '')::numeric;
    v_pct := nullif(l ->> 'comision_pct', '')::numeric;
    -- Envio incluido en el articulo (se resta del importe para la comision). Si no viene, se conserva.
    v_env := case when l ? 'envio' then nullif(nullif(l ->> 'envio', '')::numeric, 0) else null end;
    if v_imp is not null and v_imp < 0 then raise exception 'Importe invalido'; end if;
    if v_pct is not null and (v_pct < 0 or v_pct > 100) then raise exception 'El %% de comision va de 0 a 100'; end if;
    if v_env is not null and (v_env < 0 or v_env > coalesce(v_imp, 0)) then raise exception 'El envio no puede ser mayor que el importe del articulo'; end if;
    select * into x from public.venta_lineas where id = (l ->> 'id')::uuid and venta_id = p_venta;
    if x.id is null then raise exception 'Articulo no encontrado en la venta'; end if;
    -- Venta pagada: el vendedor solo llena lo que falta.
    if not jefa and v.porcentaje_cobrado >= 100 and (
         (x.importe is not null and round(v_imp, 2) is distinct from x.importe)
      or (x.comision_pct is not null and round(v_pct, 2) is distinct from x.comision_pct)
      or (l ? 'envio' and x.envio is not null and round(v_env, 2) is distinct from x.envio)) then
      raise exception 'La venta ya esta pagada: solo puedes llenar lo que falta; para corregir, avisale a la jefa de ventas';
    end if;
    if not (l ? 'envio') then v_env := x.envio; end if;
    if round(v_imp, 2) is distinct from x.importe or round(v_pct, 2) is distinct from x.comision_pct or round(v_env, 2) is distinct from x.envio then
      update public.venta_lineas
         set importe = round(v_imp, 2), comision_pct = round(v_pct, 2), envio = round(v_env, 2), comision_por = auth.uid(), comision_at = now()
       where id = x.id;
    end if;
  end loop;
end $$;
revoke all on function public.venta_comisiones(uuid, jsonb) from public, anon;
grant execute on function public.venta_comisiones(uuid, jsonb) to authenticated;

commit;
