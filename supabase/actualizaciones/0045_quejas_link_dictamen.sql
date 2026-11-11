-- =============================================================================
-- 0045_quejas_link_dictamen.sql   (requiere 0044 ya aplicado)
-- Quejas de cliente:
--   * Link publico /quejas (para tarjetas y firmas de correo): el cliente llena el mismo formato
--     sin cuenta y la queja cae al coordinador ISO como "Por revisar".
--   * Dictamen: el coordinador ISO decide si la queja APLICA o NO APLICA. Mientras esta por revisar
--     no se puede cambiar el estatus, abrir accion correctiva, comentar ni subir evidencia.
--     Si aplica, se desbloquea todo (y puede asignarle el vendedor). Si no aplica, queda el motivo.
--   * Las quejas que captura un vendedor tambien llegan "Por revisar"; las que captura el ISO ya aplican.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- 1) Columnas y estatus nuevos
alter table public.quejas alter column created_by drop not null;
alter table public.quejas drop constraint quejas_estado_check;
alter table public.quejas add constraint quejas_estado_check
  check (estado in ('por_revisar', 'no_aplica', 'abierta', 'en_analisis', 'con_sac', 'cerrada'));
alter table public.quejas drop constraint quejas_via_recepcion_check;
alter table public.quejas add constraint quejas_via_recepcion_check
  check (via_recepcion in ('telefono', 'correo', 'whatsapp', 'visita', 'sitio_web', 'link', 'otro'));
alter table public.quejas
  add column origen text not null default 'interno' check (origen in ('interno', 'link')),
  add column dictamen_nota text check (dictamen_nota is null or length(dictamen_nota) <= 2000),
  add column dictamen_por uuid references public.profiles (id),
  add column dictamen_nombre text,
  add column dictamen_at timestamptz;
alter table public.calidad_eventos drop constraint calidad_eventos_tipo_check;
alter table public.calidad_eventos add constraint calidad_eventos_tipo_check
  check (tipo in ('alta', 'estado', 'comentario', 'sac', 'archivo', 'dictamen'));
create index quejas_por_revisar_idx on public.quejas (created_at) where estado = 'por_revisar';

-- 2) Alta y cambios
create or replace function public.quejas_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.solucion := null;
    new.dictamen_nota := null; new.dictamen_por := null; new.dictamen_nombre := null; new.dictamen_at := null;
    if current_setting('esc.queja_link', true) = '1' then
      new.created_by := null;
      new.origen := 'link';
      new.via_recepcion := 'link';
      new.responsable_nombre := 'Link de quejas';
      new.vendedor_id := null;
      new.estado := 'por_revisar';
    else
      new.created_by := auth.uid();
      new.origen := 'interno';
      new.responsable_nombre := coalesce(nullif(trim(new.responsable_nombre), ''), public.my_name());
      if public.is_seller() then new.vendedor_id := auth.uid(); end if;  -- el coordinador ISO elige el vendedor
      new.estado := case when public.is_iso() then 'abierta' else 'por_revisar' end;
      if new.estado = 'abierta' then
        new.dictamen_por := auth.uid(); new.dictamen_nombre := public.my_name(); new.dictamen_at := now();
      end if;
    end if;
  end if;
  if TG_OP = 'UPDATE' then
    if not public.is_iso() then
      if new.estado is distinct from old.estado then raise exception 'Solo el coordinador ISO cambia el estatus de la queja'; end if;
      new.solucion := old.solucion;
      new.vendedor_id := old.vendedor_id;
    end if;
    if coalesce(current_setting('esc.queja_dictamen', true), '') <> '1' then
      if new.estado is distinct from old.estado and old.estado in ('por_revisar', 'no_aplica') then
        raise exception 'Primero decide si la queja aplica (botón Sí aplica / No aplica)';
      end if;
      if new.estado is distinct from old.estado and new.estado in ('por_revisar', 'no_aplica') then
        raise exception 'Para marcar que no aplica usa el botón No aplica';
      end if;
      new.origen := old.origen;
      new.dictamen_nota := old.dictamen_nota; new.dictamen_por := old.dictamen_por;
      new.dictamen_nombre := old.dictamen_nombre; new.dictamen_at := old.dictamen_at;
    end if;
    if new.estado is distinct from old.estado then
      new.cerrada_at := case when new.estado = 'cerrada' then now() end;
    end if;
  end if;
  return new;
end $$;

create or replace function public.quejas_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_link text := '/calidad/quejas/' || new.id;
  label constant jsonb := '{"por_revisar":"Por revisar","no_aplica":"No aplica","abierta":"Abierta","en_analisis":"En analisis","con_sac":"Con accion correctiva","cerrada":"Cerrada"}';
begin
  if TG_OP = 'INSERT' then
    if new.origen = 'link' then
      insert into public.calidad_eventos (queja_id, tipo, nota, autor_nombre)
      values (new.id, 'alta', 'Recibida por el link de quejas', left(coalesce(nullif(trim(new.contacto_nombre), ''), new.cliente_nombre), 150));
      perform public.notify_role('coordinador_iso', 'queja_nueva', 'Queja por link ' || new.numero || ': ' || new.cliente_nombre,
                                 'Revisa si aplica. ' || left(new.descripcion, 120), v_link, new.id);
    else
      insert into public.calidad_eventos (queja_id, tipo, nota) values (new.id, 'alta', null);
      perform public.notify_role('coordinador_iso', 'queja_nueva',
                                 case when new.estado = 'por_revisar' then 'Queja por revisar ' else 'Nueva queja ' end || new.numero || ': ' || new.cliente_nombre,
                                 left(new.descripcion, 140), v_link, new.id);
    end if;
  elsif new.estado is distinct from old.estado and coalesce(current_setting('esc.queja_dictamen', true), '') <> '1' then
    insert into public.calidad_eventos (queja_id, tipo, nota)
    values (new.id, 'estado', (label ->> new.estado) || coalesce(': ' || nullif(trim(new.solucion), ''), ''));
    perform public.notify_user(new.vendedor_id, 'queja_estado', 'Queja ' || new.numero || ': ' || (label ->> new.estado),
                               new.cliente_nombre, v_link, new.id);
  end if;
  return null;
end $$;

-- El vendedor corrige su queja mientras esta por revisar o abierta.
drop policy quejas_update_seller on public.quejas;
create policy quejas_update_seller on public.quejas for update to authenticated
  using (public.is_seller() and created_by = auth.uid() and estado in ('por_revisar', 'abierta'))
  with check (public.is_seller() and created_by = auth.uid());

-- Comentarios y evidencia: solo cuando la queja ya aplica.
create or replace function public.can_write_queja(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quejas q where q.id = p_id and q.estado not in ('por_revisar', 'no_aplica'))
     and (public.is_iso() or (public.is_seller() and exists (
       select 1 from public.quejas q where q.id = p_id and (q.vendedor_id = auth.uid() or q.created_by = auth.uid()))));
$$;

-- Accion correctiva: solo sobre quejas que aplican.
create or replace function public.sac_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then new.created_by := auth.uid(); end if;
  if new.queja_id is not null and (TG_OP = 'INSERT' or new.queja_id is distinct from old.queja_id)
     and exists (select 1 from public.quejas where id = new.queja_id and estado in ('por_revisar', 'no_aplica')) then
    raise exception 'Esa queja todavía no se marca como que aplica';
  end if;
  if new.estado = 'cerrada' and new.fecha_cierre is null then new.fecha_cierre := public.local_today(); end if;
  return new;
end $$;

-- 3) Link publico: el cliente manda la queja sin cuenta.
create or replace function public.queja_link_crear(p_cliente text, p_contacto text, p_medio text, p_referencia text, p_descripcion text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_num text;
  v_cli text := left(trim(coalesce(p_cliente, '')), 200);
  v_con text := left(trim(coalesce(p_contacto, '')), 150);
  v_med text := left(trim(coalesce(p_medio, '')), 200);
  v_ref text := nullif(left(trim(coalesce(p_referencia, '')), 200), '');
  v_des text := left(trim(coalesce(p_descripcion, '')), 4000);
begin
  if length(v_cli) < 2 then raise exception 'Escriba el nombre de su empresa'; end if;
  if length(v_con) < 2 then raise exception 'Escriba su nombre'; end if;
  if length(v_med) < 5 then raise exception 'Escriba un teléfono o correo para contactarle'; end if;
  if length(v_des) < 10 then raise exception 'Describa con más detalle el problema'; end if;
  -- Mismo mensaje enviado dos veces seguidas: se regresa el folio que ya se genero.
  select numero into v_num from public.quejas
   where origen = 'link' and created_at > now() - interval '15 minutes'
     and lower(cliente_nombre) = lower(v_cli) and descripcion = v_des limit 1;
  if v_num is not null then return v_num; end if;
  if (select count(*) from public.quejas where origen = 'link' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Estamos recibiendo muchas quejas en este momento. Intente de nuevo en un rato o llámenos.';
  end if;
  perform set_config('esc.queja_link', '1', true);
  insert into public.quejas (via_recepcion, cliente_nombre, contacto_nombre, contacto_medio, referencia, descripcion)
  values ('link', v_cli, v_con, v_med, v_ref, v_des)
  returning numero into v_num;
  perform set_config('esc.queja_link', '', true);
  return v_num;
end $$;
revoke all on function public.queja_link_crear(text, text, text, text, text) from public;
grant execute on function public.queja_link_crear(text, text, text, text, text) to anon, authenticated;

-- 4) Dictamen del coordinador ISO
create or replace function public.queja_dictaminar(p_id uuid, p_aplica boolean, p_nota text default null, p_vendedor uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare q public.quejas; v_nota text := nullif(left(trim(coalesce(p_nota, '')), 2000), '');
begin
  if not public.is_iso() then raise exception 'Solo el coordinador ISO decide si la queja aplica' using errcode = '42501'; end if;
  select * into q from public.quejas where id = p_id for update;
  if q.id is null then raise exception 'No encontrado'; end if;
  if q.estado not in ('por_revisar', 'no_aplica') then raise exception 'Esta queja ya se marcó como que aplica'; end if;
  if q.estado = 'no_aplica' and not p_aplica then raise exception 'Ya estaba marcada como que no aplica'; end if;
  if not p_aplica and v_nota is null then raise exception 'Escribe por qué no aplica'; end if;
  if p_vendedor is not null and not exists (select 1 from public.profiles where id = p_vendedor and rol = 'vendedor' and activo) then
    raise exception 'Vendedor inválido';
  end if;
  perform set_config('esc.queja_dictamen', '1', true);
  update public.quejas
     set estado = case when p_aplica then 'abierta' else 'no_aplica' end,
         vendedor_id = coalesce(p_vendedor, vendedor_id),
         dictamen_nota = v_nota, dictamen_por = auth.uid(), dictamen_nombre = public.my_name(), dictamen_at = now()
   where id = p_id
   returning * into q;
  perform set_config('esc.queja_dictamen', '', true);
  insert into public.calidad_eventos (queja_id, tipo, nota)
  values (q.id, 'dictamen', case when p_aplica then 'Sí aplica' else 'No aplica' end || coalesce(': ' || v_nota, ''));
  perform public.notify_user(q.vendedor_id, case when p_aplica then 'queja_nueva' else 'queja_estado' end,
    'Queja ' || q.numero || case when p_aplica then ' aplica: ya se le da seguimiento' else ' no aplica' end,
    q.cliente_nombre || coalesce(' · ' || v_nota, ''), '/calidad/quejas/' || q.id, q.id);
end $$;
revoke all on function public.queja_dictaminar(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.queja_dictaminar(uuid, boolean, text, uuid) to authenticated;

-- 5) Demostracion: las quejas de ejemplo ya vienen revisadas.
create or replace function public.demo_calidad() returns text
language plpgsql security definer set search_path = public as $$
declare v_iso uuid := public.demo_user('coordinador_iso'); q1 uuid; q2 uuid; q3 uuid; v_s uuid; r text := '';
begin
  perform public.demo_as(public.demo_seller(0));
  insert into public.quejas (via_recepcion, customer_id, cliente_nombre, contacto_nombre, contacto_medio, referencia, descripcion)
  values ('telefono', public.demo_customer('Manufacturas del Norte (Demo)'), 'Manufacturas del Norte (Demo)', 'Laura Méndez', '656 100 2030',
          'Factura A-1180', 'Llegaron 3 cajas de guantes talla M en lugar de talla L. El cliente pide el cambio esta semana.')
  returning id into q1;
  perform public.demo_as(public.demo_seller(1));
  insert into public.quejas (via_recepcion, customer_id, cliente_nombre, contacto_nombre, contacto_medio, referencia, descripcion)
  values ('correo', public.demo_customer('Autopartes Bravo (Demo)'), 'Autopartes Bravo (Demo)', 'Jorge Ríos', 'jrios@bravo-demo.mx',
          'OC 45122', 'La entrega llego 5 días después de lo prometido y la linea se detuvo medio turno.')
  returning id into q2;
  insert into public.quejas (via_recepcion, customer_id, cliente_nombre, contacto_nombre, referencia, descripcion)
  values ('whatsapp', public.demo_customer('Hospital Santa Clara (Demo)'), 'Hospital Santa Clara (Demo)', 'Dra. Ana Lucía Paz',
          'Factura A-1201', 'Dos cajas de batas llegaron con el empaque roto.')
  returning id into q3;
  insert into public.calidad_eventos (queja_id, tipo, nota) values (q2, 'comentario', 'El cliente mandó fotos del acuse de recibo con la fecha');
  r := '3 quejas';
  if v_iso is not null then
    perform public.demo_as(v_iso);
    perform public.queja_dictaminar(q1, true, null, null);
    perform public.queja_dictaminar(q2, true, null, null);
    perform public.queja_dictaminar(q3, true, null, null);
    update public.quejas set estado = 'en_analisis' where id = q1;
    update public.quejas set estado = 'cerrada', solucion = 'Se repusieron las 2 cajas sin costo y se revisó el empaque con el proveedor.' where id = q3;
    insert into public.acciones_correctivas (solicitante, codigo_control, clausula, fuente, queja_id, descripcion, equipo, correccion, contencion,
      consecuencia, objetivo, causas, causa_raiz, procesos_afectados, actualizar_riesgos, plan, plan_crea_riesgo, estado)
    values (public.my_name(), 'ESC-SGC-FR-001', '8.5.1', 'queja_cliente', q2, 'Entrega fuera del tiempo prometido al cliente.',
      jsonb_build_array(jsonb_build_object('nombre', public.my_name(), 'puesto', 'Coordinador ISO'), jsonb_build_object('nombre', 'Compras', 'puesto', 'Comprador')),
      'Se envió el material por paquetería express sin costo', 'Revisar los pedidos abiertos con el mismo proveedor',
      'Paro de línea del cliente', 'Cumplir 100% las fechas de entrega comprometidas',
      jsonb_build_object('metodo', 'No se confirma la fecha con el proveedor antes de prometerla', 'mano_obra', 'Se prometió fecha sin consultar a compras'),
      'No existe confirmación de fecha de entrega con el proveedor antes de cotizar', 'Ventas, compras', true,
      jsonb_build_array(
        jsonb_build_object('actividad', 'Agregar confirmación de fecha del proveedor en la cotización', 'responsable', 'Compras', 'fecha', to_char(public.local_today() + 7, 'YYYY-MM-DD'), 'reprogramacion', '', 'hecho', true),
        jsonb_build_object('actividad', 'Capacitar a vendedores en tiempos de entrega', 'responsable', 'Jefa de ventas', 'fecha', to_char(public.local_today() + 14, 'YYYY-MM-DD'), 'reprogramacion', '', 'hecho', false)),
      false, 'en_proceso')
    returning id into v_s;
    insert into public.calidad_eventos (sac_id, tipo, nota) values (v_s, 'comentario', 'Primera actividad completada');
    r := r || ' y 1 accion correctiva';
  else
    r := r || ' (sin coordinador ISO activo no se crean acciones correctivas)';
  end if;
  return r;
end $$;

commit;
