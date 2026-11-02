"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { Result } from "@/actions/requests";
import { useCustomerSearch } from "@/components/customers";
import { Icon } from "@/components/icons";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import type { CustomerRecord } from "@/lib/validation/customer";

export const areaCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:bg-slate-50";

export function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

/** Ejecuta una accion de servidor con estado de carga, aviso y refresco. */
export function useRun() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [, start] = useTransition();
  function run(key: string, fn: () => Promise<Result | Result<{ id: string }>>, ok?: string | ((r: Result<{ id: string }>) => void)) {
    setNotice(null);
    setBusy(key);
    start(async () => {
      try {
        const r = (await fn()) as Result<{ id: string }>;
        if (!r.ok) return setNotice({ tone: "error", text: r.error });
        if (typeof ok === "function") ok(r);
        else {
          if (ok) setNotice({ tone: "success", text: ok });
          router.refresh();
        }
      } catch {
        setNotice({ tone: "error", text: "No se pudo completar. Revisa tu conexión e intenta de nuevo." });
      } finally {
        setBusy(null);
      }
    });
  }
  return { run, busy, notice, setNotice, router };
}

export interface TimelineEvent {
  id: string;
  texto: string;
  autor: string | null;
  fecha: string;
  comentario?: boolean;
}

export function Timeline({ events, onComment, placeholder = "Escribe un comentario" }: { events: TimelineEvent[]; onComment?: (nota: string) => Promise<Result>; placeholder?: string }) {
  const [text, setText] = useState("");
  const { run, busy, notice } = useRun();
  return (
    <div className="space-y-3">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {onComment && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run("c", async () => {
              const r = await onComment(text);
              if (r.ok) setText("");
              return r;
            });
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} maxLength={1000} />
          <Button type="submit" variant="secondary" loading={busy === "c"} disabled={text.trim().length < 2}>Enviar</Button>
        </form>
      )}
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">Sin movimientos.</p>
      ) : (
        <ol className="space-y-2.5 border-l-2 border-slate-200 pl-4 text-sm">
          {events.map((e) => (
            <li key={e.id}>
              <span className="text-xs text-slate-500">
                {new Date(e.fecha).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {e.autor && ` · ${e.autor}`}
              </span>
              <p className={e.comentario ? "whitespace-pre-line rounded-md bg-slate-50 px-2.5 py-1.5 text-slate-800" : "text-slate-600"}>{e.texto}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Subir un archivo con una accion que recibe FormData. */
export function FileUpload({
  action,
  fields,
  accept,
  label = "Subir archivo",
  extra,
}: {
  action: (fd: FormData) => Promise<Result>;
  fields: Record<string, string>;
  accept: string;
  label?: string;
  extra?: (fd: FormData) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const { run, busy, notice } = useRun();
  return (
    <div className="space-y-2">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <Icon name="download" className="h-4 w-4 rotate-180" />
          <span className="max-w-[14rem] truncate">{name || "Elegir archivo"}</span>
          <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => setName(e.target.files?.[0]?.name ?? "")} />
        </label>
        <Button
          type="button"
          loading={busy === "up"}
          disabled={!name}
          onClick={() =>
            run(
              "up",
              async () => {
                const fd = new FormData();
                for (const [k, v] of Object.entries(fields)) fd.set(k, v);
                const f = ref.current?.files?.[0];
                if (f) fd.set("file", f);
                extra?.(fd);
                const r = await action(fd);
                if (r.ok) {
                  setName("");
                  if (ref.current) ref.current.value = "";
                }
                return r;
              },
              "Archivo subido.",
            )
          }
        >
          {label}
        </Button>
      </div>
    </div>
  );
}

/** Buscar un cliente registrado para llenar datos (los vendedores no ven la lista completa). */
export function CustomerLookup({ onPick, placeholder = "Buscar cliente registrado para llenar los datos" }: { onPick: (c: CustomerRecord) => void; placeholder?: string }) {
  const { q, setQ, results, loading } = useCustomerSearch();
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {loading ? <Spinner className="h-4 w-4" /> : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
      </span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" autoComplete="off" />
      {q.trim().length >= 2 && !loading && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Sin resultados. Llena los datos a mano.</p>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onPick(c);
                  setQ("");
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-slate-900">{c.nombre}</span>
                <span className="block text-xs text-slate-500">{[c.contacto_nombre, c.contacto_telefono, c.estado_geo].filter(Boolean).join(" · ")}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Dl({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="whitespace-pre-line break-words text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
