"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import { addBitacoraCommentAction, archiveBitacoraAction, claimBitacoraAction, createBitacoraAction, updateBitacoraAction } from "@/actions/bitacora";
import { convertCustomerAction } from "@/actions/customers";
import { CustomerPicker, KindBadge } from "@/components/customers";
import { Alert, Button, Card, Input, Select } from "@/components/ui";
import { currentStage, eventText, STAGES, stageState, type BitacoraRow, type StageKey } from "@/lib/bitacora/stages";
import { bitacoraMissing, customerMissing, type CustomerKind, type CustomerRecord } from "@/lib/validation/customer";

type Form = {
  necesidad: string;
  fecha_catalogo: string;
  fecha_muestra: string;
  muestra_no_aplica: boolean;
  fecha_solicitud_compras: string;
  fecha_cotizacion: string;
  fecha_pedido: string;
  facturacion: "" | "contado" | "credito";
  fecha_factura: string;
  monto_venta: string;
  moneda: "MXN" | "USD";
  porcentaje_cobranza: string;
  fecha_entrega: string;
  cartera_dias_vencidos: string;
  cartera_monto: string;
  comentarios: string;
  proximo_seguimiento: string;
  request_id: string;
  resultado: "abierta" | "ganada" | "perdida";
  motivo_perdida: string;
};

const toForm = (r: BitacoraRow | null): Form => ({
  necesidad: r?.necesidad ?? "",
  fecha_catalogo: r?.fecha_catalogo ?? "",
  fecha_muestra: r?.fecha_muestra ?? "",
  muestra_no_aplica: r?.muestra_no_aplica ?? false,
  fecha_solicitud_compras: r?.fecha_solicitud_compras ?? "",
  fecha_cotizacion: r?.fecha_cotizacion ?? "",
  fecha_pedido: r?.fecha_pedido ?? "",
  facturacion: r?.facturacion ?? "",
  fecha_factura: r?.fecha_factura ?? "",
  monto_venta: r?.monto_venta != null ? String(Number(r.monto_venta)) : "",
  moneda: r?.moneda ?? "MXN",
  porcentaje_cobranza: r?.porcentaje_cobranza != null ? String(Number(r.porcentaje_cobranza)) : "",
  fecha_entrega: r?.fecha_entrega ?? "",
  cartera_dias_vencidos: r?.cartera_dias_vencidos != null ? String(r.cartera_dias_vencidos) : "",
  cartera_monto: r?.cartera_monto != null ? String(Number(r.cartera_monto)) : "",
  comentarios: r?.comentarios ?? "",
  proximo_seguimiento: r?.proximo_seguimiento ?? "",
  request_id: r?.request_id ?? "",
  resultado: r?.resultado ?? "abierta",
  motivo_perdida: r?.motivo_perdida ?? "",
});

const area = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:bg-slate-50";
const LOST = ["Precio alto", "Ya tiene proveedor", "Sin presupuesto", "No responde", "Producto no disponible", "Tiempo de entrega"];

export interface BitacoraEvent {
  id: string;
  tipo: string;
  etapa: string | null;
  nota: string | null;
  created_at: string;
  autor: string | null;
}

export function BitacoraEditor({
  mode,
  entry,
  customer: initialCustomer,
  requests,
  events,
  today,
  timezone,
  defaultKind = "cliente",
  basePath = "/vendedor/bitacora",
}: {
  mode: "new" | "edit" | "readonly" | "claim";
  entry: BitacoraRow | null;
  customer: CustomerRecord | null;
  requests: { id: string; folio: string; submitted_at: string | null }[];
  events: BitacoraEvent[];
  today: string;
  timezone: string;
  defaultKind?: CustomerKind;
  basePath?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<Form>(() => toForm(entry));
  const [customer, setCustomer] = useState<CustomerRecord | null>(initialCustomer);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const ro = mode === "readonly" || mode === "claim";
  const dirty = JSON.stringify(v) !== JSON.stringify(toForm(entry));
  const set = <K extends keyof Form>(k: K, val: Form[K]) => setV((s) => ({ ...s, [k]: val }));
  const preview = { ...(entry ?? ({} as BitacoraRow)), ...v, porcentaje_cobranza: v.porcentaje_cobranza || null, facturacion: v.facturacion || null } as unknown as BitacoraRow;
  const stage = currentStage(preview);
  const isClient = customer?.tipo === "cliente";

  function run(key: string, fn: () => Promise<void>) {
    setNotice(null);
    setBusy(key);
    start(async () => {
      try {
        await fn();
      } finally {
        setBusy(null);
      }
    });
  }
  const payload = () => ({
    ...v,
    facturacion: v.facturacion || null,
    request_id: v.request_id || null,
  });
  function save() {
    run("save", async () => {
      if (mode === "new") {
        if (!customer) return setNotice({ tone: "error", text: "Elige o da de alta el cliente o prospecto." });
        const r = await createBitacoraAction(customer.id, payload());
        if (!r.ok) return setNotice({ tone: "error", text: r.error });
        router.push(`${basePath}/${r.id}`);
        return;
      }
      const r = await updateBitacoraAction(entry!.id, payload());
      if (!r.ok) return setNotice({ tone: "error", text: r.error });
      setNotice({ tone: "success", text: "Bitácora actualizada." });
      router.refresh();
    });
  }

  const dateField = (k: keyof Form, auto?: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="date" value={v[k] as string} disabled={ro} onChange={(e) => set(k, e.target.value as never)} className="w-44!" />
      {!ro && !v[k] && (
        <Button type="button" variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => set(k, today as never)}>Hoy</Button>
      )}
      {!ro && v[k] && (
        <button type="button" className="text-xs text-slate-500 underline" onClick={() => set(k, "" as never)}>Quitar</button>
      )}
      {auto && <span className="text-[11px] text-slate-500">{auto}</span>}
    </div>
  );

  const stageBody: Record<StageKey, React.ReactNode> = {
    catalogo: dateField("fecha_catalogo"),
    necesidad: (
      <textarea value={v.necesidad} disabled={ro} onChange={(e) => set("necesidad", e.target.value)} rows={2} className={area} placeholder="Qué producto necesita, para qué uso, volumen aproximado" />
    ),
    muestra: (
      <div className="space-y-1.5">
        {!v.muestra_no_aplica && dateField("fecha_muestra")}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={v.muestra_no_aplica} disabled={ro} onChange={(e) => set("muestra_no_aplica", e.target.checked)} /> No aplica muestra
        </label>
      </div>
    ),
    solicitud: (
      <div className="space-y-1.5">
        {dateField("fecha_solicitud_compras", "Se llena sola al enviar la solicitud en el portal")}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={v.request_id} disabled={ro} onChange={(e) => set("request_id", e.target.value)} className="w-64!">
            <option value="">Sin solicitud del portal ligada</option>
            {requests.map((r) => <option key={r.id} value={r.id}>{r.folio}{r.submitted_at ? ` (${new Date(r.submitted_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })})` : ""}</option>)}
          </Select>
          {v.request_id && mode !== "new" && basePath.startsWith("/vendedor") && (
            <Link href={`/vendedor/solicitudes/${v.request_id}`} className="text-xs font-medium text-brand-600 hover:underline">Abrir solicitud</Link>
          )}
          {!ro && customer && basePath.startsWith("/vendedor") && (
            <Link href={`/vendedor/solicitudes/nueva?cliente=${customer.id}`} className="text-xs font-medium text-brand-600 hover:underline">Crear solicitud de cotización</Link>
          )}
        </div>
      </div>
    ),
    cotizacion: dateField("fecha_cotizacion", "Se llena sola al registrar el envío de la cotización"),
    pedido: (
      <div className="space-y-2">
        {dateField("fecha_pedido", "Se llena sola al marcar una partida Ganada")}
        <div className="flex flex-wrap items-center gap-2">
          <Input value={v.monto_venta} disabled={ro} onChange={(e) => set("monto_venta", e.target.value)} inputMode="decimal" placeholder="Monto de la venta (sin IVA)" className="w-56!" />
          <Select value={v.moneda} disabled={ro} onChange={(e) => set("moneda", e.target.value as "MXN" | "USD")} className="w-24!"><option value="MXN">MXN</option><option value="USD">USD</option></Select>
        </div>
      </div>
    ),
    factura: (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-slate-300 bg-white p-0.5 text-sm">
          {(["contado", "credito"] as const).map((f) => (
            <button key={f} type="button" disabled={ro} onClick={() => set("facturacion", v.facturacion === f ? "" : f)} className={`rounded px-3 py-1 ${v.facturacion === f ? "bg-slate-800 text-white" : "text-slate-600"}`}>
              {f === "contado" ? "Contado" : "Crédito"}
            </button>
          ))}
        </div>
        {dateField("fecha_factura")}
      </div>
    ),
    entrega: dateField("fecha_entrega"),
    cobranza: (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-32">
            <Input value={v.porcentaje_cobranza} disabled={ro} onChange={(e) => set("porcentaje_cobranza", e.target.value)} inputMode="decimal" placeholder="0" className="pr-7" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
          </div>
          {!ro && [0, 50, 100].map((p) => (
            <button key={p} type="button" onClick={() => set("porcentaje_cobranza", String(p))} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200">{p}%</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs font-medium text-slate-600">Cartera:</span>
          <Input value={v.cartera_dias_vencidos} disabled={ro} onChange={(e) => set("cartera_dias_vencidos", e.target.value)} inputMode="numeric" placeholder="Días vencidos" className="w-32!" />
          <Input value={v.cartera_monto} disabled={ro} onChange={(e) => set("cartera_monto", e.target.value)} inputMode="decimal" placeholder="Monto" className="w-36!" />
        </div>
      </div>
    ),
  };

  return (
    <div className="space-y-4 pb-4">
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {mode === "claim" && (
        <Card className="flex flex-col gap-3 border-brand-100 bg-brand-50 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-brand-900">Este prospecto llegó del sitio web y no tiene vendedor. Tómalo para darle seguimiento.</p>
          <Button loading={busy === "claim"} onClick={() => run("claim", async () => {
            const r = await claimBitacoraAction(entry!.id);
            if (!r.ok) return setNotice({ tone: "error", text: r.error });
            router.refresh();
          })}>Tomar</Button>
        </Card>
      )}

      {/* Cliente */}
      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{defaultKind === "prospecto" && mode === "new" ? "Prospecto" : "Cliente"}</h2>
        {mode === "new" ? (
          <CustomerPicker value={customer} onChange={setCustomer} requireForQuote={false} defaultKind={defaultKind} />
        ) : customer ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-0.5 text-sm">
              <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-900">{customer.nombre} <KindBadge tipo={customer.tipo} /></p>
              <p className="text-slate-600">{[customer.giro, customer.estado_geo].filter(Boolean).join(" · ") || "Sin giro ni estado"}</p>
              {customer.direccion && <p className="text-slate-500">{customer.direccion}</p>}
              <p className="text-slate-600">{[customer.contacto_nombre, customer.contacto_telefono, customer.contacto_correo].filter(Boolean).join(" · ") || "Sin contacto"}</p>
              {bitacoraMissing(customer).length > 0 && <p className="text-xs font-medium text-amber-800">Falta para el formato: {bitacoraMissing(customer).join(", ")}</p>}
              {isClient && customerMissing(customer).length > 0 && <p className="text-xs text-slate-500">Para cotizarle falta: {customerMissing(customer).join(", ")}</p>}
            </div>
            {!ro && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {customer.tipo === "prospecto" && (
                  <Button className="bg-green-600 text-xs hover:bg-green-700" loading={busy === "convert"} onClick={() => run("convert", async () => {
                    const r = await convertCustomerAction(customer.id);
                    if (!r.ok) return setNotice({ tone: "error", text: r.error });
                    setCustomer(r.customer);
                    setNotice({ tone: "success", text: `${customer.nombre} ya es cliente. Este registro pasa a Ventas diarias.` });
                    router.refresh();
                  })}>Ya es cliente</Button>
                )}
                <Link href={`/vendedor/clientes?editar=${customer.id}`} className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                  {bitacoraMissing(customer).length ? "Completar datos" : "Editar datos"}
                </Link>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {/* Etapas */}
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Etapas</h2>
          <span className="text-xs text-slate-500">Etapa actual: <strong className="text-slate-800">{stage.stage?.short ?? "Sin iniciar"}</strong></span>
        </div>
        <ol>
          {STAGES.map((s, i) => {
            const st = stageState(preview, i);
            const dot = st === "done" ? "bg-green-600 text-white" : st === "na" ? "bg-slate-200 text-slate-400" : st === "pending" ? "bg-amber-400 text-white" : "bg-white text-slate-400 ring-1 ring-slate-300";
            return (
              <li key={s.key} className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-slate-100 px-4 py-3 last:border-0 sm:grid-cols-[2rem_14rem_1fr]">
                <span className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${dot}`}>{st === "done" ? "✓" : i + 1}</span>
                <div className="pb-1.5 sm:pb-0">
                  <p className="text-sm font-medium text-slate-800">{s.label}</p>
                  <p className="text-[11px] text-slate-500">{s.hint}</p>
                </div>
                <div className="col-start-2 sm:col-start-3">{stageBody[s.key]}</div>
              </li>
            );
          })}
        </ol>
      </Card>

      {/* Seguimiento y resultado */}
      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="block text-sm font-medium text-slate-700">Próximo seguimiento</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Input type="date" value={v.proximo_seguimiento} disabled={ro} onChange={(e) => set("proximo_seguimiento", e.target.value)} className="w-44!" />
              {!ro && [["Mañana", 1], ["3 días", 3], ["1 semana", 7]].map(([l, d]) => (
                <button key={l} type="button" onClick={() => set("proximo_seguimiento", DateTime.fromISO(today).plus({ days: d as number }).toISODate()!)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200">{l}</button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="block text-sm font-medium text-slate-700">Resultado</span>
            <div className="flex flex-wrap gap-1.5">
              {(["abierta", "ganada", "perdida"] as const).map((r) => (
                <button key={r} type="button" disabled={ro} onClick={() => set("resultado", r)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${v.resultado === r ? (r === "ganada" ? "border-green-600 bg-green-600 text-white" : r === "perdida" ? "border-red-600 bg-red-600 text-white" : "border-slate-800 bg-slate-800 text-white") : "border-slate-300 bg-white text-slate-700"}`}>
                  {r === "abierta" ? "En proceso" : r === "ganada" ? "Venta cerrada" : "Perdida"}
                </button>
              ))}
            </div>
            {v.resultado === "perdida" && (
              <div className="space-y-1.5 pt-1">
                <Input value={v.motivo_perdida} disabled={ro} onChange={(e) => set("motivo_perdida", e.target.value)} placeholder="¿Por qué se perdió?" list="motivos-bit" />
                <datalist id="motivos-bit">{LOST.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <span className="block text-sm font-medium text-slate-700">Comentarios</span>
          <textarea value={v.comentarios} disabled={ro} onChange={(e) => set("comentarios", e.target.value)} rows={2} className={area} placeholder="Notas generales del cliente u oportunidad" />
        </div>
      </Card>

      {!ro && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <Button onClick={save} loading={busy === "save"} disabled={mode === "edit" && !dirty} className="flex-1 sm:flex-none">
            {mode === "new" ? "Crear registro" : "Guardar avance"}
          </Button>
          {mode === "edit" && dirty && <span className="text-xs text-amber-800">Hay cambios sin guardar</span>}
          {mode === "edit" && (
            <Button variant="ghost" className="ml-auto text-xs" loading={busy === "archive"} onClick={() => run("archive", async () => {
              const r = await archiveBitacoraAction(entry!.id, !entry!.archived_at);
              if (!r.ok) return setNotice({ tone: "error", text: r.error });
              router.push(basePath);
            })}>
              {entry?.archived_at ? "Restaurar" : "Archivar"}
            </Button>
          )}
        </div>
      )}

      {/* Movimientos */}
      {mode !== "new" && (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Movimientos ({events.length})</h2>
          {mode === "edit" && (
            <div className="flex gap-2">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Agregar comentario del día (llamada, visita, acuerdo...)" maxLength={2000} />
              <Button variant="secondary" loading={busy === "comment"} disabled={comment.trim().length < 2} onClick={() => run("comment", async () => {
                const r = await addBitacoraCommentAction(entry!.id, comment);
                if (!r.ok) return setNotice({ tone: "error", text: r.error });
                setComment("");
                router.refresh();
              })}>Agregar</Button>
            </div>
          )}
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">Sin movimientos.</p>
          ) : (
            <ol className="space-y-2 border-l-2 border-slate-200 pl-4 text-sm">
              {events.map((e) => (
                <li key={e.id}>
                  <span className="text-xs text-slate-500">
                    {DateTime.fromISO(e.created_at, { zone: timezone }).setLocale("es-MX").toFormat("d LLL yyyy, HH:mm")}
                    {e.autor && ` · ${e.autor}`}
                  </span>
                  <p className={e.tipo === "comentario" ? "text-slate-800" : "text-slate-600"}>{eventText(e)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
