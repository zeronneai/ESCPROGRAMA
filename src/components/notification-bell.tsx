"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Notice {
  id: string;
  titulo: string;
  cuerpo: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const BASE_TITLE = "Portal de cotizaciones | ESC Representaciones";
const POLL_MS = 60_000;

/** Campana con contador; tambien refleja el conteo en el titulo de la pestana. */
export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const refreshCount = useCallback(async () => {
    try {
      const supabase = createClient();
      const { count: c } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      setCount(c ?? 0);
    } catch {
      /* sin red: se conserva el ultimo valor */
    }
  }, []);

  const loadList = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, titulo, cuerpo, link, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(15);
    setItems((data ?? []) as Notice[]);
  }, []);

  useEffect(() => {
    void refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, [count, pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await loadList();
  }

  async function markRead(id?: string) {
    const supabase = createClient();
    let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (id) q = q.eq("id", id);
    await q;
    await Promise.all([refreshCount(), loadList()]);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button onClick={toggle} className="relative rounded-md p-2 hover:bg-slate-100" aria-label={`Notificaciones (${count} sin leer)`}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-[1.1rem] text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <span className="text-sm font-medium">Notificaciones</span>
            <button className="text-xs text-brand-600 underline disabled:opacity-40" disabled={count === 0} onClick={() => markRead()}>
              Marcar todas como leidas
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Sin notificaciones</li>}
            {items.map((n) => (
              <li key={n.id} className={`border-b border-slate-100 px-3 py-2 text-sm ${n.read_at ? "" : "bg-brand-50"}`}>
                {n.link ? (
                  <Link href={n.link} onClick={() => { setOpen(false); void markRead(n.id); }} className="font-medium text-slate-900 hover:underline">
                    {n.titulo}
                  </Link>
                ) : (
                  <span className="font-medium">{n.titulo}</span>
                )}
                {n.cuerpo && <p className="text-xs text-slate-600">{n.cuerpo}</p>}
                <p className="text-[11px] text-slate-400">
                  {new Date(n.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
