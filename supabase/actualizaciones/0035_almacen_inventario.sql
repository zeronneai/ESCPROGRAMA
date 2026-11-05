-- =============================================================================
-- 0035_almacen_inventario.sql   (requiere 0034 ya aplicado)
-- Almacen: recepciones con etiquetas QR, inventario y carga de facturas con escaneo.
--   * RECEPCIONES: el almacenista registra lo que llega (articulos del catalogo y cantidad). Se genera
--     una etiqueta por unidad (ej. por caja master) con un codigo unico (E-000001) para imprimir.
--     Tambien sirve para el inventario inicial (lo que ya hay en el almacen).
--   * INVENTARIO: cada etiqueta "en almacen" es una unidad en existencia.
--   * ENTREGAS: el vendedor sube la factura (PDF y/o XML); el sistema lee el folio y los articulos
--     ESC-... con su cantidad. Almacen escanea cada etiqueta al cargar el camion: solo acepta etiquetas
--     de articulos que vienen en la factura y hasta la cantidad facturada. Todo intento queda registrado.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Recepciones y etiquetas
-- ---------------------------------------------------------------------------
create sequence public.recepciones_seq;
create sequence public.etiquetas_seq;

create table public.recepciones (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique default ('REC-' || lpad(nextval('public.recepciones_seq')::text, 4, '0')),
  tipo text not null default 'compra' check (tipo in ('compra', 'inventario_inicial', 'devolucion', 'ajuste')),
  fecha date not null default public.local_today(),
  orden_compra text check (orden_compra is null or length(orden_compra) <= 80),
  proveedor text check (proveedor is null or length(proveedor) <= 200),
  notas text check (notas is null or length(notas) <= 1000),
  created_by uuid not null default auth.uid() references public.profiles (id),
  autor_nombre text,
  created_at timestamptz not null default now()
);

create table public.recepcion_lineas (
  id uuid primary key default gen_random_uuid(),
  recepcion_id uuid not null references public.recepciones (id),
  articulo_id uuid not null references public.articulos (id),
  cantidad integer not null check (cantidad between 1 and 2000),
  lote text check (lote is null or length(lote) <= 80),
  created_at timestamptz not null default now()
);
create index recepcion_lineas_rec_idx on public.recepcion_lineas (recepcion_id);

create table public.etiquetas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('E-' || lpad(nextval('public.etiquetas_seq')::text, 6, '0')),
  articulo_id uuid not null references public.articulos (id),
  recepcion_id uuid not null references public.recepciones (id),
  linea_id uuid not null references public.recepcion_lineas (id),
  recibida date not null,
  estado text not null default 'almacen' check (estado in ('almacen', 'cargada', 'baja')),
  salida_id uuid,
  salida_at timestamptz,
  salida_por uuid references public.profiles (id),
  baja_motivo text check (baja_motivo is null or length(baja_motivo) <= 300),
  baja_at timestamptz,
  created_at timestamptz not null default now()
);
create index etiquetas_articulo_idx on public.etiquetas (articulo_id, estado, recibida);
create index etiquetas_recepcion_idx on public.etiquetas (recepcion_id);
create index etiquetas_salida_idx on public.etiquetas (salida_id) where salida_id is not null;

-- ---------------------------------------------------------------------------
-- Entregas (facturas por cargar)
-- ---------------------------------------------------------------------------
create table public.salidas (
  id uuid primary key default gen_random_uuid(),
  folio_factura text not null check (length(trim(folio_factura)) between 1 and 40),
  fecha_factura date,
  cliente text check (cliente is null or length(cliente) <= 300),
  vendedor_factura text check (vendedor_factura is null or length(vendedor_factura) <= 150),
  factura_path text,
  factura_nombre text,
  xml_path text,
  estado text not null default 'por_cargar' check (estado in ('por_cargar', 'cargando', 'cargada', 'cancelada')),
  incompleta boolean not null default false,
  notas text check (notas is null or length(notas) <= 1000),
  cierre_nota text check (cierre_nota is null or length(cierre_nota) <= 500),
  cargada_at timestamptz,
  cargada_por uuid references public.profiles (id),
  cargada_nombre text,
  cancelada_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles (id),
  autor_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index salidas_folio_uq on public.salidas (upper(folio_factura)) where estado <> 'cancelada';
create index salidas_estado_idx on public.salidas (estado, created_at desc);
alter table public.etiquetas add constraint etiquetas_salida_fk foreign key (salida_id) references public.salidas (id);

create table public.salida_lineas (
  id uuid primary key default gen_random_uuid(),
  salida_id uuid not null references public.salidas (id),
  orden smallint not null default 0,
  articulo_id uuid references public.articulos (id),
  clave text check (clave is null or length(clave) <= 60),
  descripcion text check (descripcion is null or length(descripcion) <= 500),
  unidad text check (unidad is null or length(unidad) <= 60),
  cantidad integer not null check (cantidad between 1 and 100000),
  escaneadas integer not null default 0 check (escaneadas >= 0)
);
create index salida_lineas_salida_idx on public.salida_lineas (salida_id);

-- Bitacora de escaneos (tambien los rechazados): rastreabilidad y control.
create table public.salida_escaneos (
  id bigint generated always as identity primary key,
  salida_id uuid not null references public.salidas (id),
  codigo text not null,
  etiqueta_id uuid references public.etiquetas (id),
  ok boolean not null,
  accion text not null default 'cargar' check (accion in ('cargar', 'quitar')),
  mensaje text,
  user_id uuid default auth.uid() references public.profiles (id),
  user_nombre text,
  created_at timestamptz not null default now()
);
create index salida_escaneos_salida_idx on public.salida_escaneos (salida_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger recepciones_autor before insert on public.recepciones for each row execute function public.set_autor();
create trigger salidas_autor before insert on public.salidas for each row execute function public.set_autor();
create trigger salidas_updated before update on public.salidas for each row execute function public.set_updated_at();
create trigger recepciones_audit after insert or update on public.recepciones for each row execute function public.audit_row();
create trigger salidas_audit after insert or update on public.salidas for each row execute function public.audit_row();
create trigger recepciones_no_delete before delete on public.recepciones for each row execute function public.forbid_mutation();
create trigger recepcion_lineas_no_delete before delete on public.recepcion_lineas for each row execute function public.forbid_mutation();
create trigger etiquetas_no_delete before delete on public.etiquetas for each row execute function public.forbid_mutation();
create trigger salidas_no_delete before delete on public.salidas for each row execute function public.forbid_mutation();
create trigger salida_escaneos_no_mut before update or delete on public.salida_escaneos for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Quien puede que
-- ---------------------------------------------------------------------------
create or replace function public.puede_subir_factura() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_seller() or public.is_sales_manager() or public.is_marketplaces() or public.is_almacen();
$$;
grant execute on function public.puede_subir_factura() to authenticated;

-- El vendedor ve sus entregas; almacen, compras, jefa de ventas, gerencia, ISO y marketplaces ven todas.
create or replace function public.puede_ver_salida(p_created_by uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_created_by = auth.uid() or public.is_almacen() or public.is_buyer() or public.is_sales_manager()
      or public.is_gerente() or public.is_iso() or public.is_marketplaces();
$$;
grant execute on function public.puede_ver_salida(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: nueva recepcion (crea las etiquetas)
-- ---------------------------------------------------------------------------
create or replace function public.recepcion_crear(p_tipo text, p_fecha date, p_orden_compra text, p_proveedor text,
                                                  p_notas text, p_lineas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; l jsonb; v_linea uuid; v_art uuid; v_cant integer; v_total integer := 0;
begin
  if not public.is_almacen() then raise exception 'Solo almacen registra recepciones' using errcode = '42501'; end if;
  if p_tipo not in ('compra', 'inventario_inicial', 'devolucion', 'ajuste') then raise exception 'Tipo invalido'; end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'Agrega al menos un articulo'; end if;
  insert into public.recepciones (tipo, fecha, orden_compra, proveedor, notas)
  values (p_tipo, coalesce(p_fecha, public.local_today()), nullif(trim(coalesce(p_orden_compra, '')), ''),
          nullif(trim(coalesce(p_proveedor, '')), ''), nullif(trim(coalesce(p_notas, '')), ''))
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    v_art := (l ->> 'articulo_id')::uuid;
    v_cant := (l ->> 'cantidad')::integer;
    if v_cant is null or v_cant < 1 or v_cant > 2000 then raise exception 'Cantidad invalida (1 a 2000)'; end if;
    if not exists (select 1 from public.articulos where id = v_art) then raise exception 'Articulo no encontrado'; end if;
    v_total := v_total + v_cant;
    if v_total > 3000 then raise exception 'Maximo 3000 etiquetas por recepcion'; end if;
    insert into public.recepcion_lineas (recepcion_id, articulo_id, cantidad, lote)
    values (v_id, v_art, v_cant, nullif(trim(coalesce(l ->> 'lote', '')), '')) returning id into v_linea;
    insert into public.etiquetas (articulo_id, recepcion_id, linea_id, recibida)
    select v_art, v_id, v_linea, coalesce(p_fecha, public.local_today()) from generate_series(1, v_cant);
  end loop;
  return v_id;
end $$;
grant execute on function public.recepcion_crear(text, date, text, text, text, jsonb) to authenticated;

-- Baja de una etiqueta (danada, extraviada, merma): sale del inventario con motivo.
create or replace function public.etiqueta_baja(p_codigo text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_almacen() then raise exception 'Solo almacen da de baja etiquetas' using errcode = '42501'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo'; end if;
  update public.etiquetas set estado = 'baja', baja_motivo = left(trim(p_motivo), 300), baja_at = now()
   where codigo = upper(trim(p_codigo)) and estado = 'almacen';
  if not found then raise exception 'La etiqueta no existe o ya no esta en almacen'; end if;
end $$;
grant execute on function public.etiqueta_baja(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: entregas
-- ---------------------------------------------------------------------------
create or replace function public.salida_crear(p_folio text, p_fecha date, p_cliente text, p_vendedor text, p_notas text,
                                               p_factura_path text, p_factura_nombre text, p_xml_path text, p_lineas jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; l jsonb; i integer := 0; v_art uuid; v_clave text; v_cant integer;
begin
  if not public.puede_subir_factura() then raise exception 'No autorizado' using errcode = '42501'; end if;
  if coalesce(trim(p_folio), '') = '' then raise exception 'Falta el folio de la factura'; end if;
  if exists (select 1 from public.salidas where upper(folio_factura) = upper(trim(p_folio)) and estado <> 'cancelada') then
    raise exception 'La factura % ya esta registrada', upper(trim(p_folio));
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then raise exception 'La factura no tiene articulos'; end if;
  insert into public.salidas (folio_factura, fecha_factura, cliente, vendedor_factura, notas, factura_path, factura_nombre, xml_path)
  values (upper(trim(p_folio)), p_fecha, nullif(left(trim(coalesce(p_cliente, '')), 300), ''), nullif(left(trim(coalesce(p_vendedor, '')), 150), ''),
          nullif(left(trim(coalesce(p_notas, '')), 1000), ''), p_factura_path, left(p_factura_nombre, 200), p_xml_path)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lineas) loop
    i := i + 1;
    v_clave := nullif(upper(trim(coalesce(l ->> 'clave', ''))), '');
    v_cant := ceil((l ->> 'cantidad')::numeric)::integer;
    if v_cant is null or v_cant < 1 then raise exception 'Cantidad invalida en la partida %', i; end if;
    select id into v_art from public.articulos where upper(clave) = v_clave;
    insert into public.salida_lineas (salida_id, orden, articulo_id, clave, descripcion, unidad, cantidad)
    values (v_id, i, v_art, v_clave, left(l ->> 'descripcion', 500), left(l ->> 'unidad', 60), v_cant);
  end loop;
  perform public.notify_role('almacen', 'salida_nueva', 'Factura por cargar: ' || upper(trim(p_folio)),
    coalesce(left(p_cliente, 120), '') , '/entregas/' || v_id, v_id);
  perform public.notify_role('supervisor_almacen', 'salida_nueva', 'Factura por cargar: ' || upper(trim(p_folio)),
    coalesce(left(p_cliente, 120), ''), '/entregas/' || v_id, v_id);
  return v_id;
end $$;
grant execute on function public.salida_crear(text, date, text, text, text, text, text, text, jsonb) to authenticated;

-- Escanear una etiqueta al cargar. Nunca truena: regresa {ok, mensaje, ...} y deja registro.
create or replace function public.salida_escanear(p_salida uuid, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.salidas; e public.etiquetas; a public.articulos; ln public.salida_lineas; v_codigo text; v_msg text; v_antigua date; v_aviso text;
begin
  if not public.is_almacen() then raise exception 'Solo almacen escanea la carga' using errcode = '42501'; end if;
  -- Acepta el codigo solo (E-000123) o una liga que lo contenga.
  v_codigo := substring(upper(coalesce(p_codigo, '')) from '(E-[0-9]{4,})');
  select * into s from public.salidas where id = p_salida for update;
  if s.id is null then raise exception 'Entrega no encontrada'; end if;
  if s.estado in ('cargada', 'cancelada') then
    v_msg := 'Esta factura ya esta ' || case when s.estado = 'cargada' then 'cargada' else 'cancelada' end;
  elsif v_codigo is null then
    v_msg := 'No es una etiqueta del sistema';
  else
    select * into e from public.etiquetas where codigo = v_codigo for update;
    if e.id is null then
      v_msg := 'La etiqueta ' || v_codigo || ' no existe';
    elsif e.estado = 'cargada' and e.salida_id = s.id then
      v_msg := 'Esta etiqueta ya se escaneo en esta factura';
    elsif e.estado = 'cargada' then
      v_msg := 'Esta etiqueta ya salio en la factura ' || coalesce((select folio_factura from public.salidas where id = e.salida_id), '?');
    elsif e.estado = 'baja' then
      v_msg := 'Esta etiqueta esta dada de baja: ' || coalesce(e.baja_motivo, '');
    else
      select * into a from public.articulos where id = e.articulo_id;
      select * into ln from public.salida_lineas where salida_id = s.id and articulo_id = e.articulo_id order by orden limit 1;
      if ln.id is null then
        v_msg := 'NO CORRESPONDE: ' || a.clave || ' no viene en la factura';
      else
        select * into ln from public.salida_lineas
         where salida_id = s.id and articulo_id = e.articulo_id and escaneadas < cantidad order by orden limit 1 for update;
        if ln.id is null then
          v_msg := 'Ya se cargo todo lo facturado de ' || a.clave;
        end if;
      end if;
    end if;
  end if;

  if v_msg is not null then
    insert into public.salida_escaneos (salida_id, codigo, etiqueta_id, ok, mensaje, user_nombre)
    values (p_salida, coalesce(v_codigo, left(coalesce(p_codigo, ''), 80)), e.id, false, v_msg, public.my_name());
    return jsonb_build_object('ok', false, 'mensaje', v_msg, 'codigo', v_codigo);
  end if;

  update public.etiquetas set estado = 'cargada', salida_id = s.id, salida_at = now(), salida_por = auth.uid() where id = e.id;
  update public.salida_lineas set escaneadas = escaneadas + 1 where id = ln.id;
  if s.estado = 'por_cargar' then update public.salidas set estado = 'cargando' where id = s.id; end if;
  -- Primeras entradas, primeras salidas: avisa si hay de ese articulo recibido antes.
  select min(recibida) into v_antigua from public.etiquetas where articulo_id = e.articulo_id and estado = 'almacen' and recibida < e.recibida;
  if v_antigua is not null then v_aviso := 'Hay ' || a.clave || ' recibido antes (' || to_char(v_antigua, 'DD/MM/YYYY') || '): conviene sacar primero lo mas viejo'; end if;
  insert into public.salida_escaneos (salida_id, codigo, etiqueta_id, ok, mensaje, user_nombre)
  values (p_salida, v_codigo, e.id, true, a.clave, public.my_name());
  return jsonb_build_object('ok', true, 'codigo', v_codigo, 'clave', a.clave, 'nombre', a.nombre, 'linea_id', ln.id,
                            'escaneadas', ln.escaneadas + 1, 'cantidad', ln.cantidad, 'aviso', v_aviso,
                            'faltan', (select coalesce(sum(cantidad - escaneadas), 0) from public.salida_lineas where salida_id = s.id and articulo_id is not null));
end $$;
grant execute on function public.salida_escanear(uuid, text) to authenticated;

-- Quitar una etiqueta escaneada por error (regresa al almacen).
create or replace function public.salida_quitar(p_salida uuid, p_codigo text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas; e public.etiquetas;
begin
  if not public.is_almacen() then raise exception 'No autorizado' using errcode = '42501'; end if;
  select * into s from public.salidas where id = p_salida for update;
  if s.estado not in ('por_cargar', 'cargando') then raise exception 'La factura ya se cerro'; end if;
  select * into e from public.etiquetas where codigo = upper(trim(p_codigo)) and salida_id = p_salida and estado = 'cargada' for update;
  if e.id is null then raise exception 'Esa etiqueta no esta en esta factura'; end if;
  update public.etiquetas set estado = 'almacen', salida_id = null, salida_at = null, salida_por = null where id = e.id;
  update public.salida_lineas set escaneadas = escaneadas - 1
   where id = (select id from public.salida_lineas where salida_id = p_salida and articulo_id = e.articulo_id and escaneadas > 0 order by orden desc limit 1);
  insert into public.salida_escaneos (salida_id, codigo, etiqueta_id, ok, accion, mensaje, user_nombre)
  values (p_salida, e.codigo, e.id, true, 'quitar', 'Se regreso al almacen', public.my_name());
end $$;
grant execute on function public.salida_quitar(uuid, text) to authenticated;

-- Terminar la carga. Si falta algo, pide el motivo y queda marcada como incompleta.
create or replace function public.salida_terminar(p_salida uuid, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas; v_faltan integer;
begin
  if not public.is_almacen() then raise exception 'Solo almacen cierra la carga' using errcode = '42501'; end if;
  select * into s from public.salidas where id = p_salida for update;
  if s.estado not in ('por_cargar', 'cargando') then raise exception 'La factura ya se cerro'; end if;
  select coalesce(sum(cantidad - escaneadas), 0) into v_faltan from public.salida_lineas where salida_id = p_salida and articulo_id is not null;
  if v_faltan > 0 and coalesce(trim(p_nota), '') = '' then raise exception 'Faltan % pieza(s): escribe por que se cierra incompleta', v_faltan; end if;
  update public.salidas
     set estado = 'cargada', incompleta = v_faltan > 0, cierre_nota = nullif(left(trim(coalesce(p_nota, '')), 500), ''),
         cargada_at = now(), cargada_por = auth.uid(), cargada_nombre = public.my_name()
   where id = p_salida;
  perform public.notify_user(s.created_by, 'salida_cargada',
    case when v_faltan > 0 then 'Factura ' || s.folio_factura || ' cargada INCOMPLETA' else 'Factura ' || s.folio_factura || ' cargada completa' end,
    coalesce(nullif(trim(coalesce(p_nota, '')), ''), coalesce(s.cliente, '')), '/entregas/' || p_salida, p_salida);
end $$;
grant execute on function public.salida_terminar(uuid, text) to authenticated;

-- Cancelar una entrega: las etiquetas escaneadas regresan al almacen.
create or replace function public.salida_cancelar(p_salida uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s public.salidas;
begin
  select * into s from public.salidas where id = p_salida for update;
  if s.id is null then raise exception 'No encontrada'; end if;
  if not (public.is_almacen() or (s.created_by = auth.uid() and s.estado = 'por_cargar')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if s.estado not in ('por_cargar', 'cargando') then raise exception 'La factura ya se cerro'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escribe el motivo'; end if;
  update public.etiquetas set estado = 'almacen', salida_id = null, salida_at = null, salida_por = null where salida_id = p_salida and estado = 'cargada';
  update public.salida_lineas set escaneadas = 0 where salida_id = p_salida;
  update public.salidas set estado = 'cancelada', cancelada_at = now(), cierre_nota = left(trim(p_motivo), 500) where id = p_salida;
end $$;
grant execute on function public.salida_cancelar(uuid, text) to authenticated;
revoke all on function public.recepcion_crear(text, date, text, text, text, jsonb), public.etiqueta_baja(text, text),
  public.salida_crear(text, date, text, text, text, text, text, text, jsonb), public.salida_escanear(uuid, text),
  public.salida_quitar(uuid, text), public.salida_terminar(uuid, text), public.salida_cancelar(uuid, text) from anon;

-- Inventario por articulo (respeta los permisos de quien consulta).
create or replace function public.inventario_resumen() returns table (articulo_id uuid, clave text, nombre text, familia text,
  en_almacen bigint, cargadas bigint, bajas bigint, primera date, ultima date)
language sql stable security invoker set search_path = public as $$
  select a.id, a.clave, a.nombre, a.familia,
         count(*) filter (where e.estado = 'almacen'), count(*) filter (where e.estado = 'cargada'), count(*) filter (where e.estado = 'baja'),
         min(e.recibida) filter (where e.estado = 'almacen'), max(e.recibida)
    from public.etiquetas e join public.articulos a on a.id = e.articulo_id
   group by a.id, a.clave, a.nombre, a.familia;
$$;
grant execute on function public.inventario_resumen() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.recepciones enable row level security;
alter table public.recepcion_lineas enable row level security;
alter table public.etiquetas enable row level security;
alter table public.salidas enable row level security;
alter table public.salida_lineas enable row level security;
alter table public.salida_escaneos enable row level security;
revoke all on public.recepciones, public.recepcion_lineas, public.etiquetas, public.salidas, public.salida_lineas, public.salida_escaneos from anon, authenticated;
grant select on public.recepciones, public.recepcion_lineas, public.etiquetas, public.salidas, public.salida_lineas, public.salida_escaneos to authenticated;
grant update (notas) on public.salidas to authenticated;
grant update (notas, orden_compra, proveedor) on public.recepciones to authenticated;

-- Inventario y recepciones: los consulta cualquier usuario activo (no tiene precios).
create policy recepciones_select on public.recepciones for select to authenticated using (public.is_active_user());
create policy recepcion_lineas_select on public.recepcion_lineas for select to authenticated using (public.is_active_user());
create policy etiquetas_select on public.etiquetas for select to authenticated using (public.is_active_user());
create policy recepciones_update on public.recepciones for update to authenticated using (public.is_almacen()) with check (public.is_almacen());
create policy salidas_select on public.salidas for select to authenticated using (public.puede_ver_salida(created_by));
create policy salidas_update on public.salidas for update to authenticated
  using (public.is_almacen() or created_by = auth.uid()) with check (public.is_almacen() or created_by = auth.uid());
create policy salida_lineas_select on public.salida_lineas for select to authenticated
  using (exists (select 1 from public.salidas s where s.id = salida_id and public.puede_ver_salida(s.created_by)));
create policy salida_escaneos_select on public.salida_escaneos for select to authenticated
  using (exists (select 1 from public.salidas s where s.id = salida_id and public.puede_ver_salida(s.created_by)));

-- Archivos de facturas (PDF y XML).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas', 'facturas', false, 10485760, array['application/pdf', 'text/xml', 'application/xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy facturas_storage_select on storage.objects for select to authenticated
  using (bucket_id = 'facturas' and public.is_active_user());
create policy facturas_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas' and public.puede_subir_factura());

commit;
