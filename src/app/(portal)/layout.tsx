import { Suspense } from "react";
import { Logo } from "@/components/logo";
import { NavigationProgress } from "@/components/navigation-progress";
import { NotificationBell } from "@/components/notification-bell";
import { PortalNav, type NavItem } from "@/components/portal-nav";
import { requireUser } from "@/lib/auth/guards";

const NAV: Record<"comprador" | "vendedor", NavItem[]> = {
  comprador: [
    { href: "/comprador", label: "Pendientes", icon: "inbox", match: ["/comprador/solicitudes"] },
    { href: "/comprador/historial", label: "Historial", icon: "history" },
    { href: "/comprador/por-comprar", label: "Por comprar", short: "Comprar", icon: "cart" },
    { href: "/comprador/estadisticas", label: "Estadísticas", short: "Stats", icon: "chart" },
    { href: "/comprador/clientes", label: "Clientes", icon: "building", secondary: true },
    { href: "/comprador/proveedores", label: "Proveedores", icon: "truck", secondary: true },
    { href: "/comprador/usuarios", label: "Usuarios", icon: "users", secondary: true },
    { href: "/comprador/configuracion", label: "Configuración", icon: "settings", secondary: true },
    { href: "/comprador/auditoria", label: "Auditoría", icon: "shield", secondary: true },
  ],
  vendedor: [
    { href: "/vendedor", label: "Mis solicitudes", short: "Solicitudes", icon: "list", match: ["/vendedor/solicitudes"] },
    { href: "/vendedor/clientes", label: "Clientes", icon: "building" },
    { href: "/vendedor/solicitudes/nueva", label: "Nueva solicitud", short: "Nueva", icon: "plus", cta: true },
    { href: "/vendedor/leads", label: "Leads", icon: "target" },
  ],
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <PortalNav items={NAV[user.rol]} user={{ nombre: user.nombre, rol: user.rol }} bell={<NotificationBell />} logo={<Logo className="h-7 sm:h-8" />} />
      <main className="pb-safe-nav mx-auto max-w-6xl px-4 pt-5 sm:pt-6">{children}</main>
    </div>
  );
}
