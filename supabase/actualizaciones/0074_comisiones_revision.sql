-- =============================================================================
-- 0074_comisiones_revision.sql   (requiere 0073 ya aplicado)
-- Comisiones: el vendedor las pone desde "Mis comisiones", la jefa las revisa y la gerente ve lo revisado.
--   * El vendedor pone la comision de sus ventas ya registradas (pagadas o no):
--       - venta NO pagada: la pone y la corrige;
--       - venta pagada: solo puede llenar lo que falta (lo que ya tiene valor, solo la jefa lo cambia);
--       - ya revisada por la jefa: el vendedor ya no la cambia.
--   * La jefa de ventas marca cada factura como revisada (solo si todos sus articulos tienen comision).
--   * La gerente (y el CEO) ven solo las comisiones revisadas, por vendedor y por factura.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

alter table public.ventas
  add column if not exists comision_revisada_at timestamptz,
  add column if not exists comision_revisada_por uuid references public.profiles (id);

create or replace function public.venta_comisiones(p_venta uuid, p_lineas jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v public.ventas; l jsonb; x public.venta_lineas; v_imp numeric; v_pct numeric; jefa boolean := public.is_sales_manager();
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
    if v_imp is not null and v_imp < 0 then raise exception 'Importe invalido'; end if;
    if v_pct is not null and (v_pct < 0 or v_pct > 100) then raise exception 'El %% de comision va de 0 a 100'; end if;
    select * into x from public.venta_lineas where id = (l ->> 'id')::uuid and venta_id = p_venta;
    if x.id is null then raise exception 'Articulo no encontrado en la venta'; end if;
    -- Venta pagada: el vendedor solo llena lo que falta.
    if not jefa and v.porcentaje_cobrado >= 100 and (
         (x.importe is not null and round(v_imp, 2) is distinct from x.importe)
      or (x.comision_pct is not null and round(v_pct, 2) is distinct from x.comision_pct)) then
      raise exception 'La venta ya esta pagada: solo puedes llenar lo que falta; para corregir, avisale a la jefa de ventas';
    end if;
    if round(v_imp, 2) is distinct from x.importe or round(v_pct, 2) is distinct from x.comision_pct then
      update public.venta_lineas
         set importe = round(v_imp, 2), comision_pct = round(v_pct, 2), comision_por = auth.uid(), comision_at = now()
       where id = x.id;
    end if;
  end loop;
end $$;
revoke all on function public.venta_comisiones(uuid, jsonb) from public, anon;
grant execute on function public.venta_comisiones(uuid, jsonb) to authenticated;

-- La jefa marca (o quita) la revision de la comision de una venta.
create or replace function public.venta_comision_revisar(p_venta uuid, p_revisada boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v public.ventas;
begin
  if not public.is_sales_manager() then raise exception 'Solo la jefa de ventas revisa las comisiones' using errcode = '42501'; end if;
  select * into v from public.ventas where id = p_venta;
  if v.id is null then raise exception 'Venta no encontrada'; end if;
  if p_revisada then
    if v.cancelada_at is not null then raise exception 'La venta esta cancelada'; end if;
    if not exists (select 1 from public.venta_lineas where venta_id = p_venta) then raise exception 'La venta no tiene articulos'; end if;
    if exists (select 1 from public.venta_lineas where venta_id = p_venta and (importe is null or comision_pct is null)) then
      raise exception 'Falta el importe o el %% de comision de algun articulo';
    end if;
    update public.ventas set comision_revisada_at = now(), comision_revisada_por = auth.uid() where id = p_venta;
  else
    update public.ventas set comision_revisada_at = null, comision_revisada_por = null where id = p_venta;
  end if;
end $$;
revoke all on function public.venta_comision_revisar(uuid, boolean) from public, anon;
grant execute on function public.venta_comision_revisar(uuid, boolean) to authenticated;

commit;
