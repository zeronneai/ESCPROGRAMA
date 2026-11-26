import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Wordmark } from "@/components/marca";
import { NavigationProgress } from "@/components/navigation-progress";
import { HelpChat } from "@/components/help-chat";
import { FirmaCorreo } from "@/components/firma/firma-correo";
import { PagosAviso } from "@/components/pagos/pagos-aviso";
import { CatalogoAviso } from "@/components/catalogo-aviso";
import { NotificationBell } from "@/components/notification-bell";
import { RealtimeSync } from "@/components/realtime-sync";
import { AvisoConciliacion } from "@/components/finanzas/aviso-conciliacion";
import { AvisoMetaProspeccion } from "@/components/prospeccion/aviso-meta";
import { RIESGO_ROLES } from "@/lib/riesgos";
import { CATALOGO, CATALOGO_VISIBLE } from "@/lib/marca";
import { AddCustomerButton } from "@/components/customers";
import { AddSupplierButton } from "@/components/eval/supplier-tools";
import { PortalNav, type NavItem } from "@/components/portal-nav";
import { requireUser } from "@/lib/auth/guards";
import { almacenVentasActivo, RUTAS_ALMACEN_VENTAS } from "@/lib/almacen-ventas";
import { createClient } from "@/lib/supabase/server";
import type { Rol } from "@/lib/auth/route-guard";

const NAV: Record<Rol, NavItem[]> = {
  comprador: [
    { href: "/comprador", label: "Pendientes", icon: "inbox", match: ["/comprador/solicitudes"] },
    { href: "/comprador/historial", label: "Historial", icon: "history", secondary: true },
    { href: "/comprador/por-comprar", label: "Por comprar", short: "Comprar", icon: "cart" },
    { href: "/comprador/planeacion", label: "Planeación de compras", short: "Planear", icon: "chart", match: ["/comprador/planeacion/oc", "/comprador/planeacion/inventario"] },
    { href: "/comprador/planeacion/pedidos", label: "Pedidos de vendedores", short: "Pedidos", icon: "cart", secondary: true },
    { href: "/comprador/planeacion/asistente", label: "Asistente de compras (Claude)", short: "Asistente", icon: "chat", secondary: true },
    { href: "/metas", label: "Metas de venta (en vivo)", short: "Metas", icon: "target", secondary: true },
    { href: "/periodo-metas", label: "Periodo de metas y leer facturas", short: "Periodo", icon: "target", secondary: true },
    { href: "/finanzas/conciliaciones", label: "Conciliaciones", short: "Bancos", icon: "inbox", secondary: true },
    { href: "/pedidos-pegatron", label: "Pedidos Pegatron", short: "Pegatron", icon: "clipboard", secondary: true },
    { href: "/comprador/catalogo", label: "Comentarios del catálogo", icon: "chat", secondary: true },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/pagos", label: "Pagos", icon: "dollar" },
    { href: "/guias", label: "Guías", icon: "package", secondary: true },
    { href: "/comprador/estadisticas", label: "Estadísticas", short: "Stats", icon: "chart", secondary: true },
    { href: "/ventas", label: "Ventas", icon: "target", secondary: true },
    { href: "/calidad", label: "Quejas y acciones correctivas", icon: "alert", secondary: true },
    { href: "/comprador/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/articulos", label: "Artículos", icon: "package", secondary: true },
    { href: "/comprador/proveedores", label: "Proveedores", icon: "truck", secondary: true },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", icon: "truck", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/comprador/usuarios", label: "Usuarios", icon: "users", secondary: true },
    { href: "/comprador/configuracion", label: "Configuración", icon: "settings", secondary: true },
    { href: "/comprador/demo-recepcion", label: "Demo: Recepción de facturas", icon: "inbox", secondary: true },
    { href: "/comprador/auditoria", label: "Auditoría", icon: "shield", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/calidad/cambios", label: "Control de cambios", icon: "history", secondary: true },
    { href: "/entregas", label: "Entregas (facturas)", icon: "truck", secondary: true },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  vendedor: [
    { href: "/vendedor", label: "Mis solicitudes", short: "Solicitudes", icon: "list", match: ["/vendedor/solicitudes"] },
    { href: "/vendedor/bitacora", label: "Bitácora", icon: "target" },
    { href: "/vendedor/solicitudes/nueva", label: "Nueva solicitud", short: "Nueva", icon: "plus", cta: true },
    { href: "/guias", label: "Guías", icon: "package" },
    { href: "/pedidos-compras", label: "Pedir al comprador", short: "Pedir", icon: "cart", secondary: true },
    { href: "/metas", label: "Metas de venta", short: "Metas", icon: "target", secondary: true },
    { href: "/vendedor/conciliaciones", label: "Conciliaciones", short: "Pagos", icon: "dollar", secondary: true },
    { href: "/vendedor/comisiones", label: "Mis comisiones", short: "Comisiones", icon: "dollar", secondary: true },
    { href: "/vendedor/recepcion-facturas", label: "Recepción de facturas", short: "Facturas", icon: "dollar", secondary: true },
    { href: "/vendedor/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/articulos", label: "Catálogo de artículos", icon: "list", secondary: true },
    { href: "/calidad", label: "Quejas de cliente", icon: "alert", secondary: true },
    { href: "/consumo", label: "Consumo interno", icon: "clipboard", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/entregas", label: "Entregas", icon: "truck", secondary: true, match: ["/entregas"] },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  jefe_ventas: [
    { href: "/ventas", label: "Resumen", icon: "chart", match: ["/ventas/vendedor", "/ventas/bitacora"] },
    { href: "/ventas/comisiones", label: "Comisiones", icon: "dollar" },
    { href: "/metas", label: "Metas de venta (en vivo)", short: "Metas", icon: "target", secondary: true },
    { href: "/ventas/meta-prospeccion", label: "Configurar metas", short: "Config. metas", icon: "target", secondary: true },
    { href: "/captura-ventas", label: "Sumar ventas de José Ortiz", short: "Sumar", icon: "dollar", secondary: true },
    { href: "/vendedor/bitacora", label: "Mi bitácora", short: "Bitácora", icon: "target" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/ventas/clientes", label: "Clientes", icon: "building" },
    { href: "/pedidos-pegatron", label: "Pedidos Pegatron", short: "Pegatron", icon: "cart" },
    { href: "/guias", label: "Guías", icon: "package", secondary: true },
    { href: "/pedidos-compras", label: "Pedir al comprador", short: "Pedir", icon: "cart", secondary: true },
    { href: "/vendedor/conciliaciones", label: "Conciliaciones (mis pagos)", icon: "dollar", secondary: true },
    { href: "/finanzas/conciliaciones", label: "Conciliaciones (todos los pagos)", icon: "inbox", secondary: true },
    { href: "/vendedor/recepcion-facturas", label: "Mis facturas a finanzas", icon: "dollar", secondary: true },
    { href: "/finanzas/recepcion", label: "Recepción de facturas (finanzas)", icon: "inbox", secondary: true },
    { href: "/calidad", label: "Quejas y acciones correctivas", icon: "alert", secondary: true },
    { href: "/articulos", label: "Catálogo de artículos", icon: "list", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/entregas", label: "Entregas", icon: "truck", match: ["/entregas"] },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  gerente: [
    { href: "/ventas", label: "Ventas", icon: "chart", match: ["/ventas/vendedor", "/ventas/bitacora"] },
    { href: "/cotizaciones", label: "Cotizaciones", short: "Cotiz.", icon: "inbox" },
    { href: "/ventas/comisiones", label: "Comisiones", short: "Comisión", icon: "dollar" },
    { href: "/metas", label: "Metas de venta (en vivo)", short: "Metas", icon: "target", secondary: true },
    { href: "/ventas/meta-prospeccion", label: "Configurar metas", short: "Config. metas", icon: "target", secondary: true },
    { href: "/pedidos-compras", label: "Pedir al comprador", short: "Pedir", icon: "cart", secondary: true },
    { href: "/finanzas/conciliaciones", label: "Conciliaciones", short: "Bancos", icon: "inbox", secondary: true },
    { href: "/finanzas/recepcion", label: "Recepción de facturas", short: "Facturas", icon: "inbox", secondary: true },
    { href: "/calidad", label: "Calidad", icon: "alert" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/guias", label: "Guías", icon: "package" },
    { href: "/ventas/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/pedidos-pegatron", label: "Pedidos Pegatron", icon: "cart", secondary: true },
    { href: "/articulos", label: "Catálogo de artículos", icon: "list", secondary: true },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", icon: "truck", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/calidad/cambios", label: "Control de cambios", icon: "history", secondary: true },
    { href: "/entregas", label: "Entregas (facturas)", icon: "truck", secondary: true },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  coordinador_iso: [
    { href: "/calidad", label: "Quejas y acciones correctivas", short: "Calidad", icon: "alert" },
    { href: "/documentos", label: "Documentos", short: "Docs", icon: "list" },
    { href: "/norma-iso", label: "Norma ISO 9001", short: "ISO", icon: "shield" },
    { href: "/calidad/cambios", label: "Control de cambios", short: "Cambios", icon: "history", secondary: true },
    { href: "/ventas", label: "Ventas", icon: "chart", match: ["/ventas/vendedor", "/ventas/bitacora"] },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard", secondary: true },
    { href: "/guias", label: "Guías", icon: "package", secondary: true },
    { href: "/ventas/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/articulos", label: "Catálogo de artículos", icon: "list", secondary: true },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", icon: "truck", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/entregas", label: "Entregas (facturas)", icon: "truck", secondary: true },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  marketplaces: [
    { href: "/guias", label: "Guías", icon: "package" },
    { href: "/periodo-metas", label: "Periodo de metas", short: "Periodo", icon: "target", secondary: true },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/entregas", label: "Entregas", icon: "truck", match: ["/entregas"] },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  almacen: [
    { href: "/entregas", label: "Entregas por cargar", short: "Entregas", icon: "truck", match: ["/entregas"] },
    { href: "/almacen/recepciones", label: "Recepciones", short: "Recibir", icon: "inbox" },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", match: ["/almacen/inventario", "/almacen/etiqueta"] },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", short: "Evaluación", icon: "truck", secondary: true },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
  ],
  supervisor_almacen: [
    { href: "/entregas", label: "Entregas por cargar", short: "Entregas", icon: "truck", match: ["/entregas"] },
    { href: "/almacen/recepciones", label: "Recepciones", short: "Recibir", icon: "inbox" },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", match: ["/almacen/inventario", "/almacen/etiqueta"] },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", short: "Evaluación", icon: "truck", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "list", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
  ],
  ceo: [
    { href: "/pagos", label: "Pagos a proveedores", short: "Pagos", icon: "dollar" },
    { href: "/ventas", label: "Ventas", icon: "chart", match: ["/ventas/vendedor", "/ventas/bitacora"] },
    { href: "/ventas/comisiones", label: "Comisiones", icon: "dollar", secondary: true },
    { href: "/metas", label: "Metas de venta (en vivo)", short: "Metas", icon: "target", secondary: true },
    { href: "/ventas/meta-prospeccion", label: "Configurar metas", short: "Config. metas", icon: "target", secondary: true },
    { href: "/pedidos-compras", label: "Pedir al comprador", short: "Pedir", icon: "cart", secondary: true },
    { href: "/finanzas/conciliaciones", label: "Conciliaciones", icon: "inbox", secondary: true },
    { href: "/finanzas/recepcion", label: "Recepción de facturas", icon: "inbox", secondary: true },
    { href: "/calidad", label: "Calidad", icon: "alert" },
    { href: "/minutas", label: "Minutas", icon: "list", secondary: true },
    { href: "/consumo", label: "Consumo interno", icon: "clipboard", secondary: true },
    { href: "/guias", label: "Guías", icon: "package", secondary: true },
    { href: "/ventas/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/pedidos-pegatron", label: "Pedidos Pegatron", icon: "cart", secondary: true },
    { href: "/articulos", label: "Catálogo de artículos", icon: "list", secondary: true },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", icon: "truck", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/calidad/cambios", label: "Control de cambios", icon: "history", secondary: true },
    { href: "/entregas", label: "Entregas (facturas)", icon: "truck", secondary: true },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  supervisor_finanzas: [
    { href: "/finanzas/recepcion", label: "Recepción de facturas", short: "Facturas", icon: "inbox" },
    { href: "/finanzas/conciliaciones", label: "Conciliaciones", short: "Bancos", icon: "dollar" },
    { href: "/minutas", label: "Minutas", icon: "list" },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/entregas", label: "Entregas (facturas)", icon: "truck", secondary: true },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
  aux_finanzas: [
    { href: "/finanzas/recepcion", label: "Recepción de facturas", short: "Facturas", icon: "inbox" },
    { href: "/finanzas/conciliaciones", label: "Conciliaciones", short: "Bancos", icon: "dollar" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
  ],
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const almacenOn = await almacenVentasActivo(await createClient());
  // La guia de la norma ISO 9001 la puede consultar todo el personal (en "Mas").
  const base = NAV[user.rol].some((i) => i.href === "/norma-iso") ? NAV[user.rol] : [...NAV[user.rol], { href: "/norma-iso", label: "Norma ISO 9001", icon: "shield" as const, secondary: true }];
  // Vendedor que la jefa eligio para capturar ventas de una meta sin usuario (ej. telemarketing).
  const captura = (user.rol === "vendedor" || user.rol === "marketplaces") && !!(await (await createClient()).from("metas_venta").select("id").eq("capturista_id", user.id).limit(1)).data?.length;
  const nav = [...base, ...(captura ? [{ href: "/captura-ventas", label: "Sumar ventas de José Ortiz", short: "Sumar", icon: "dollar" as const, secondary: true }] : [])].filter((i) => almacenOn || !RUTAS_ALMACEN_VENTAS.includes(i.href));
  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <PortalNav items={[{ href: "/inicio", label: "Inicio", icon: "home" }, ...nav, ...(RIESGO_ROLES.includes(user.rol) ? [{ href: "/calidad/riesgos", label: "Análisis de riesgo", icon: "chart" as const, secondary: true }] : []), ...(CATALOGO_VISIBLE ? [{ href: CATALOGO.archivo, label: "Catálogo 2026", icon: "download" as const, secondary: true }] : [])]} user={{ nombre: user.nombre, rol: user.rol }} bell={
          <>
            {user.rol === "comprador" && <AddSupplierButton />}
            {(user.rol === "vendedor" || user.rol === "jefe_ventas" || user.rol === "comprador") && <AddCustomerButton />}
            <NotificationBell />
          </>
        } logo={<span className="flex items-center gap-2"><Logo className="h-7 sm:h-8" /><Wordmark className="hidden border-l border-slate-200 pl-2 text-base sm:inline" /></span>} />
      <RealtimeSync />
      {(user.rol === "vendedor" || user.rol === "jefe_ventas") && <AvisoConciliacion destino="/vendedor/conciliaciones" />}
      {(user.rol === "gerente" || user.rol === "ceo") && <AvisoConciliacion destino="/finanzas/conciliaciones" />}
      {user.rol === "vendedor" && <AvisoMetaProspeccion />}
      <main className="pb-safe-nav mx-auto max-w-6xl px-4 pt-5 sm:pt-6">{children}</main>
      <HelpChat rol={user.rol} nombre={user.nombre} />
      <Suspense fallback={null}>
        <PagosAviso rol={user.rol} />
      </Suspense>
      <Suspense fallback={null}>
        <FirmaCorreo user={user} />
      </Suspense>
      <Suspense fallback={null}>
        <CatalogoAviso userId={user.id} rol={user.rol} />
      </Suspense>
    </div>
  );
}
