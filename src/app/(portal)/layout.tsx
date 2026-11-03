import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { NavigationProgress } from "@/components/navigation-progress";
import { HelpChat } from "@/components/help-chat";
import { NotificationBell } from "@/components/notification-bell";
import { AddCustomerButton } from "@/components/customers";
import { PortalNav, type NavItem } from "@/components/portal-nav";
import { requireUser } from "@/lib/auth/guards";
import type { Rol } from "@/lib/auth/route-guard";

const NAV: Record<Rol, NavItem[]> = {
  comprador: [
    { href: "/comprador", label: "Pendientes", icon: "inbox", match: ["/comprador/solicitudes"] },
    { href: "/comprador/historial", label: "Historial", icon: "history" },
    { href: "/comprador/por-comprar", label: "Por comprar", short: "Comprar", icon: "cart" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
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
  ],
  coordinador_iso: [
    { href: "/calidad", label: "Quejas y acciones correctivas", short: "Calidad", icon: "alert" },
    { href: "/ventas", label: "Ventas", icon: "chart", match: ["/ventas/vendedor", "/ventas/bitacora"] },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/guias", label: "Guías", icon: "package" },
    { href: "/ventas/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/articulos", label: "Catálogo de artículos", icon: "list", secondary: true },
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", icon: "truck", secondary: true },
    { href: "/evaluaciones/clientes", label: "Evaluación de clientes", icon: "users", secondary: true },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
  ],
  marketplaces: [
    { href: "/guias", label: "Guías", icon: "package" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
  ],
  almacen: [
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", short: "Evaluación", icon: "truck" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/indicadores", label: "Indicadores", icon: "chart" },
    { href: "/minutas", label: "Minutas", icon: "clipboard", secondary: true },
  ],
  supervisor_almacen: [
    { href: "/evaluaciones/proveedores", label: "Evaluación de proveedores", short: "Evaluación", icon: "truck" },
    { href: "/minutas", label: "Minutas", icon: "list" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
    { href: "/indicadores", label: "Indicadores", icon: "chart", secondary: true },
  ],
  supervisor_finanzas: [
    { href: "/minutas", label: "Minutas", icon: "list" },
    { href: "/consumo", label: "Consumo interno", short: "Consumo", icon: "clipboard" },
  ],
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <PortalNav items={NAV[user.rol]} user={{ nombre: user.nombre, rol: user.rol }} bell={
          <>
            {(user.rol === "vendedor" || user.rol === "jefe_ventas" || user.rol === "comprador") && <AddCustomerButton />}
            <NotificationBell />
          </>
        } logo={<Logo className="h-7 sm:h-8" />} />
      <main className="pb-safe-nav mx-auto max-w-6xl px-4 pt-5 sm:pt-6">{children}</main>
      <HelpChat rol={user.rol} nombre={user.nombre} />
    </div>
  );
}
