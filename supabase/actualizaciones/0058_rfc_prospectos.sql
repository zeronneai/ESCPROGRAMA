-- =============================================================================
-- 0058_rfc_prospectos.sql
-- RFC de los prospectos:
--  * A un PROSPECTO ya se le puede mandar solicitud de cotizacion sin RFC (a los clientes se les sigue pidiendo).
--  * El RFC de ESC (ERE060228NLA) ya no se acepta como RFC de un cliente: se guarda vacio.
--  * Limpieza: los clientes que tenian el RFC de ESC se quedan sin RFC, para que al subir su
--    factura o constancia se llene el RFC correcto (la venta con factura llena el RFC vacio).
-- Se puede correr en cualquier momento.
-- Como aplicarlo: pega este archivo COMPLETO en SQL Editor y presiona Run.
-- =============================================================================
begin;

-- RFC de ESC (del perfil de la empresa, sin espacios ni la palabra RFC) o el conocido.
create or replace function public.rfc_esc() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(regexp_replace(regexp_replace(upper(coalesce(rfc, '')), '^\s*RFC[:\s]*', ''), '[\s.-]', '', 'g'), '') from public.company_profile limit 1),
    'ERE060228NLA');
$$;
grant execute on function public.rfc_esc() to authenticated;

create or replace function public.customers_data_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nombre := trim(new.nombre);
  new.rfc := nullif(upper(regexp_replace(coalesce(new.rfc, ''), '[\s.-]', '', 'g')), '');
  -- El RFC de ESC no es el de un cliente: se deja vacio.
  if new.rfc is not null and (new.rfc = public.rfc_esc() or new.rfc = 'ERE060228NLA') then new.rfc := null; end if;
  new.razon_social := nullif(trim(coalesce(new.razon_social, '')), '');
  new.direccion := nullif(trim(coalesce(new.direccion, '')), '');
  new.contacto_nombre := nullif(trim(coalesce(new.contacto_nombre, '')), '');
  new.contacto_telefono := nullif(trim(coalesce(new.contacto_telefono, '')), '');
  new.contacto_correo := nullif(lower(trim(coalesce(new.contacto_correo, ''))), '');
  if new.rfc is not null and not public.rfc_valido(new.rfc) then
    raise exception 'RFC invalido: deben ser 12 o 13 caracteres (extranjero: XEXX010101000)';
  end if;
  if new.contacto_correo is not null and new.contacto_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Correo del cliente invalido';
  end if;
  if new.contacto_telefono is not null and length(regexp_replace(new.contacto_telefono, '\D', '', 'g')) < 7 then
    raise exception 'Telefono del cliente invalido';
  end if;
  if TG_OP = 'UPDATE' and new.activo is distinct from old.activo and not public.is_buyer() then
    raise exception 'Solo el comprador puede activar o desactivar clientes';
  end if;
  return new;
end $$;

-- Para mandar la solicitud: el RFC solo es obligatorio para clientes (no para prospectos).
create or replace function public.customer_is_complete(p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.customers c
     where c.id = p_id
       and length(c.nombre) >= 2
       and (c.tipo = 'prospecto' or (c.rfc is not null and public.rfc_valido(c.rfc)))
       and length(coalesce(c.direccion, '')) >= 5
       and (c.contacto_telefono is not null or c.contacto_correo is not null)
  );
$$;

create or replace function public.quote_requests_customer_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and old.estado = 'borrador' and new.estado = 'enviada'
     and not public.customer_is_complete(new.customer_id) then
    raise exception 'Completa los datos del cliente (RFC si ya es cliente, direccion y telefono o correo) antes de enviar la solicitud';
  end if;
  return new;
end $$;

-- Limpieza: quitar el RFC de ESC de los clientes y prospectos que lo tenian (el trigger lo deja vacio).
update public.customers set rfc = null where rfc in (public.rfc_esc(), 'ERE060228NLA');

commit;
