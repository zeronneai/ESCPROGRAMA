"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";

export interface NavItem {
  href: string;
  label: string;
  /** Etiqueta corta para la barra inferior en movil. */
  short?: string;
  icon: IconName;
  /** Otras rutas que tambien marcan este enlace como activo. */
  match?: string[];
  /** true: va en el menu "Mas" (no en la barra principal). */
  secondary?: boolean;
  /** Boton de accion destacado (ej. Nueva solicitud). */
  cta?: boolean;
}

function isActive(pathname: string, item: NavItem, all: NavItem[]): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  const hit = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (!prefixes.some(hit)) return false;
  // Si otro enlace es mas especifico para esta ruta, gana ese.
  const myLen = Math.max(...prefixes.filter(hit).map((p) => p.length));
  return !all.some((o) => o !== item && [o.href, ...(o.match ?? [])].some((p) => hit(p) && p.length > myLen));
}

const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/** Navegacion del portal: barra superior en escritorio y barra inferior + hoja "Mas" en movil. */
export function PortalNav({
  items,
  user,
  bell,
  logo,
}: {
  items: NavItem[];
  user: { nombre: string; rol: string };
  bell: React.ReactNode;
  logo: React.ReactNode;
}) {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSheet(false);
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheet]);

  const primary = items.filter((i) => !i.secondary);
  const secondary = items.filter((i) => i.secondary);
  const secondaryActive = secondary.some((i) => isActive(pathname, i, items));
  const rolLabel = user.rol === "comprador" ? "Comprador" : "Vendedor";

  const logout = (
    <form action="/api/auth/logout" method="post">
      <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50">
        <Icon name="logout" className="h-4 w-4" />
        Cerrar sesión
      </button>
    </form>
  );

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link href={items[0]?.href ?? "/"} className="shrink-0" aria-label="Inicio">
            {logo}
          </Link>

          {/* Escritorio */}
          <nav className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex" aria-label="Principal">
            {primary.map((i) => {
              const active = isActive(pathname, i, items);
              return i.cta ? (
                <Link
                  key={i.href}
                  href={i.href}
                  className="ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  <Icon name={i.icon} className="h-4 w-4" />
                  {i.label}
                </Link>
              ) : (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon name={i.icon} className="h-4 w-4" />
                  {i.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1 md:hidden" />

          <div className="flex items-center gap-2">
            {bell}
            <div className="relative hidden md:block" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenu((m) => !m)}
                aria-expanded={menu}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition ${
                  secondaryActive || menu ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                  {initials(user.nombre)}
                </span>
                <span className="max-w-[10rem] truncate text-slate-700">{user.nombre.split(" ")[0]}</span>
                <svg viewBox="0 0 20 20" className="h-4 w-4 text-slate-400" fill="currentColor" aria-hidden>
                  <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                </svg>
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-60 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium text-slate-900">{user.nombre}</p>
                    <p className="text-xs text-slate-500">{rolLabel}</p>
                  </div>
                  {secondary.length > 0 && <div className="my-1 border-t border-slate-100" />}
                  {secondary.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                        isActive(pathname, i, items) ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <Icon name={i.icon} className="h-4 w-4" />
                      {i.label}
                    </Link>
                  ))}
                  <div className="my-1 border-t border-slate-100" />
                  {logout}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Movil: barra inferior */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Principal"
      >
        <ul className="mx-auto flex max-w-md items-stretch justify-around">
          {primary.map((i) => {
            const active = isActive(pathname, i, items);
            return (
              <li key={i.href} className="flex-1">
                <Link
                  href={i.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-700" : "text-slate-500"}`}
                >
                  {i.cta ? (
                    <span className="-mt-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-white shadow-md ring-4 ring-white">
                      <Icon name={i.icon} className="h-5 w-5" />
                    </span>
                  ) : (
                    <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-brand-50" : ""}`}>
                      <Icon name={i.icon} className="h-5 w-5" />
                    </span>
                  )}
                  {i.short ?? i.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setSheet(true)}
              className={`flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${secondaryActive ? "text-brand-700" : "text-slate-500"}`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${secondaryActive ? "bg-brand-50" : ""}`}>
                <Icon name="menu" className="h-5 w-5" />
              </span>
              Más
            </button>
          </li>
        </ul>
      </nav>

      {/* Movil: hoja "Mas" */}
      {sheet && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button className="absolute inset-0 bg-slate-900/40" aria-label="Cerrar menú" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-xl">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300" />
            <div className="flex items-center gap-3 px-2 py-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {initials(user.nombre)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{user.nombre}</p>
                <p className="text-xs text-slate-500">{rolLabel}</p>
              </div>
              <button onClick={() => setSheet(false)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {secondary.length > 0 && (
              <div className="mt-1 grid grid-cols-3 gap-2">
                {secondary.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium ${
                      isActive(pathname, i, items) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-700"
                    }`}
                  >
                    <Icon name={i.icon} className="h-5 w-5" />
                    {i.label}
                  </Link>
                ))}
              </div>
            )}
            <div className="mt-3 border-t border-slate-100 pt-2">{logout}</div>
          </div>
        </div>
      )}
    </>
  );
}
