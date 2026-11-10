import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { Wordmark } from "@/components/marca";
import { NavigationProgress } from "@/components/navigation-progress";
import { HelpChat } from "@/components/help-chat";
import { PagosAviso } from "@/components/pagos/pagos-aviso";
import { NotificationBell } from "@/components/notification-bell";
import { RealtimeSync } from "@/components/realtime-sync";
import { RIESGO_ROLES } from "@/lib/riesgos";
import { AddCustomerButton } from "@/components/customers";
import { AddSupplierButton } from "@/components/eval/supplier-tools";
import { PortalNav, type NavItem } from "@/components/portal-nav";
import { requireUser } from "@/lib/auth/guards";
import type { Rol } from "@/lib/auth/route-guard";

const NAV: Record<Rol, NavItem[]> = {
  comprador: [
    { href: "/comprador", label: "Pendientes", icon: "inbox", match: ["/comprador/solicitudes"] },
    { href: "/comprador/historial", label: "Historial", icon: "history", secondary: true },
    { href: "/comprador/por-comprar", label: "Por comprar", short: "Comprar", icon: "cart" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/pagos", label: "Pagos", icon: "dollar" },
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
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/ventas/clientes", label: "Clientes", icon: "building" },
    { href: "/guias", label: "Guías", icon: "package", secondary: true },
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
    { href: "/calidad", label: "Calidad", icon: "alert" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/guias", label: "Guías", icon: "package" },
    { href: "/ventas/clientes", label: "Clientes", icon: "building", secondary: true },
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
    { href: "/calidad", label: "Calidad", icon: "alert" },
    { href: "/minutas", label: "Minutas", icon: "list", secondary: true },
    { href: "/consumo", label: "Consumo interno", icon: "clipboard", secondary: true },
    { href: "/guias", label: "Guías", icon: "package", secondary: true },
    { href: "/ventas/clientes", label: "Clientes", icon: "building", secondary: true },
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
    { href: "/minutas", label: "Minutas", icon: "list" },
    { href: "/documentos", label: "Documentos", icon: "list", secondary: true },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/entregas", label: "Entregas (facturas)", icon: "truck", secondary: true },
    { href: "/almacen/inventario", label: "Inventario", icon: "package", secondary: true, match: ["/almacen/inventario", "/almacen/etiqueta"] },
  ],
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <PortalNav items={[{ href: "/inicio", label: "Inicio", icon: "home" }, ...NAV[user.rol], ...(RIESGO_ROLES.includes(user.rol) ? [{ href: "/calidad/riesgos", label: "Análisis de riesgo", icon: "chart" as const, secondary: true }] : []), { href: "/catalogo-esc-2026.pdf", label: "Catálogo 2026", icon: "download", secondary: true }]} user={{ nombre: user.nombre, rol: user.rol }} bell={
          <>
            {user.rol === "comprador" && <AddSupplierButton />}
            {(user.rol === "vendedor" || user.rol === "jefe_ventas" || user.rol === "comprador") && <AddCustomerButton />}
            <NotificationBell />
          </>
        } logo={<span className="flex items-center gap-2"><Logo className="h-7 sm:h-8" /><Wordmark className="hidden border-l border-slate-200 pl-2 text-base sm:inline" /></span>} />
      <RealtimeSync />
      <main className="pb-safe-nav mx-auto max-w-6xl px-4 pt-5 sm:pt-6">{children}</main>
      <HelpChat rol={user.rol} nombre={user.nombre} />
      <Suspense fallback={null}>
        <PagosAviso rol={user.rol} />
      </Suspense>
    </div>
  );
}
