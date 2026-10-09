import Link from "next/link";
import { Logo } from "@/components/logo";
import { NotificationBell } from "@/components/notification-bell";
import { requireUser } from "@/lib/auth/guards";

const NAV = {
  comprador: [
    { href: "/comprador", label: "Pendientes" },
    { href: "/comprador/por-comprar", label: "Por comprar" },
    { href: "/comprador/estadisticas", label: "Estadisticas" },
    { href: "/comprador/historial", label: "Historial" },
    { href: "/comprador/clientes", label: "Clientes" },
    { href: "/comprador/proveedores", label: "Proveedores" },
    { href: "/comprador/usuarios", label: "Usuarios" },
    { href: "/comprador/configuracion", label: "Configuracion" },
    { href: "/comprador/auditoria", label: "Auditoria" },
  ],
  vendedor: [{ href: "/vendedor", label: "Mis solicitudes" }],
} as const;

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Logo />
          <nav className="flex flex-1 flex-wrap gap-4 text-sm font-medium">
            {NAV[user.rol].map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-700 hover:text-brand-600">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <NotificationBell />
            <span className="text-slate-600">
              {user.nombre} ({user.rol})
            </span>
            <form action="/api/auth/logout" method="post">
              <button className="text-slate-600 underline">Salir</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
