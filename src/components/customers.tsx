"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { convertCustomerAction, listSucursalesAction, saveCustomerAction, saveSucursalAction, searchCustomersAction, setCustomerActiveAction, setCustomerKindAction } from "@/actions/customers";
import { Icon } from "@/components/icons";
import { Alert, Button, Card, EmptyState, Field, Input, Select, Spinner } from "@/components/ui";
import {
  customerMissing,
  ESTADOS_MX,
  KIND_LABEL,
  matchCustomer,
  RFC_EXTRANJERO,
  type CustomerKind,
  type CustomerRecord,
} from "@/lib/validation/customer";

type Form = Record<"tipo" | "nombre" | "razon_social" | "giro" | "estado_geo" | "rfc" | "direccion" | "contacto_nombre" | "contacto_telefono" | "contacto_correo", string>;
const toForm = (c?: Partial<CustomerRecord> | null, nombre = "", tipo: CustomerKind = "cliente"): Form => ({
  tipo: c?.tipo ?? tipo,
  nombre: c?.nombre ?? nombre,
  razon_social: c?.razon_social ?? "",
  giro: c?.giro ?? "",
  estado_geo: c?.estado_geo ?? "",
  rfc: c?.rfc ?? "",
  direccion: c?.direccion ?? "",
  contacto_nombre: c?.contacto_nombre ?? "",
  contacto_telefono: c?.contacto_telefono ?? "",
  contacto_correo: c?.contacto_correo ?? "",
});

const area = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";
const GIROS = ["Electrónica", "Automotriz", "Dispositivos médicos", "Aeroespacial", "Laboratorio", "Alimentos", "Construcción", "Maquila", "Gobierno"];

export function KindBadge({ tipo }: { tipo: CustomerKind }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tipo === "cliente" ? "bg-green-100 text-green-800" : "bg-sky-100 text-sky-800"}`}>
      {KIND_LABEL[tipo]}
    </span>
  );
}

/** Alta o edicion de un cliente de la base general. */
export function CustomerForm({
  customer,
  initialName = "",
  initialKind = "cliente",
  onSaved,
  onCancel,
}: {
  customer?: CustomerRecord | null;
  initialName?: string;
  initialKind?: CustomerKind;
  onSaved: (c: CustomerRecord) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<Form>(() => toForm(customer, initialName, initialKind));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: "" }));
  };
  // Un cliente ya convertido no se puede regresar a prospecto desde aqui (solo comprador o jefa).
  const lockedClient = customer?.tipo === "cliente";
  function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    start(async () => {
      const r = await saveCustomerAction(customer?.id ?? null, v as never);
      if (!r.ok) {
        setError(r.error);
        setErrors(("fields" in r && r.fields) || {});
        return;
      }
      onSaved(r.customer);
    });
  }
  if (customer?.parent_id) return <SucursalForm parentId={customer.parent_id} sucursal={customer} onSaved={onSaved} onCancel={onCancel} />;
  return (
    <div className="space-y-4">
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-1">
        <span className="block text-sm font-medium text-slate-700">¿Ya es cliente? *</span>
        <div className="grid grid-cols-2 gap-2 sm:max-w-md">
          {(["cliente", "prospecto"] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={lockedClient && k === "prospecto"}
              onClick={() => setV((s) => ({ ...s, tipo: k }))}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-40 ${v.tipo === k ? (k === "cliente" ? "border-green-600 bg-green-50 ring-1 ring-green-600" : "border-sky-600 bg-sky-50 ring-1 ring-sky-600") : "border-slate-200 bg-white"}`}
            >
              <span className="block font-semibold">{KIND_LABEL[k]}</span>
              <span className="block text-xs text-slate-500">{k === "cliente" ? "Ya nos compra" : "Aún no nos compra"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre (como lo conocen) *" error={errors.nombre}>
          <Input value={v.nombre} onChange={set("nombre")} autoFocus={!customer} placeholder="Ej. Foxconn Planta 3" />
        </Field>
        <Field label="Razón social" error={errors.razon_social}>
          <Input value={v.razon_social} onChange={set("razon_social")} placeholder="Como aparece en la factura" />
        </Field>
        <Field label="Giro de la empresa *" error={errors.giro}>
          <Input value={v.giro} onChange={set("giro")} list="giros" placeholder="Ej. Electrónica" />
          <datalist id="giros">{GIROS.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>
        <Field label="Estado *" error={errors.estado_geo}>
          <Select value={v.estado_geo} onChange={set("estado_geo")}>
            <option value="">Elige...</option>
            {ESTADOS_MX.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
        <Field label={v.tipo === "cliente" ? "RFC *" : "RFC (si lo tienes)"} error={errors.rfc}>
          <Input value={v.rfc} onChange={set("rfc")} className="font-mono uppercase" maxLength={16} placeholder="ABC010101AB1" />
          <span className="block text-[11px] text-slate-500">
            Extranjero:{" "}
            <button type="button" className="underline" onClick={() => setV((s) => ({ ...s, rfc: RFC_EXTRANJERO }))}>{RFC_EXTRANJERO}</button>
          </span>
        </Field>
        <Field label="Persona de contacto" error={errors.contacto_nombre}>
          <Input value={v.contacto_nombre} onChange={set("contacto_nombre")} placeholder="Ej. Laura Méndez (Compras)" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Dirección *" error={errors.direccion}>
            <textarea value={v.direccion} onChange={set("direccion")} rows={2} className={area} placeholder="Calle, número, colonia, ciudad, C.P." />
          </Field>
        </div>
        <Field label="Teléfono / WhatsApp" error={errors.contacto_telefono}>
          <Input value={v.contacto_telefono} onChange={set("contacto_telefono")} type="tel" inputMode="tel" placeholder="614 123 4567" />
        </Field>
        <Field label="Correo" error={errors.contacto_correo}>
          <Input value={v.contacto_correo} onChange={set("contacto_correo")} type="email" inputMode="email" placeholder="compras@cliente.com" />
        </Field>
      </div>
      <p className="text-xs text-slate-500">* Obligatorios, además de teléfono o correo. Para cotizarle a un prospecto también se necesita su RFC.</p>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{customer ? "Guardar" : "Dar de alta"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>}
      </div>
    </form>
    {customer && <SucursalesPanel parent={customer} />}
    </div>
  );
}

type SForm = Record<"sucursal" | "direccion" | "estado_geo" | "contacto_nombre" | "contacto_telefono" | "contacto_correo", string>;

/** Alta o edicion de una sucursal (titulo, direccion y contacto; lo demas viene de la matriz). */
export function SucursalForm({
  parentId,
  sucursal,
  defaultEstado = "",
  onSaved,
  onCancel,
}: {
  parentId: string;
  sucursal?: CustomerRecord | null;
  defaultEstado?: string;
  onSaved: (c: CustomerRecord) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<SForm>({
    sucursal: sucursal?.sucursal ?? "",
    direccion: sucursal?.direccion ?? "",
    estado_geo: sucursal?.estado_geo ?? defaultEstado,
    contacto_nombre: sucursal?.contacto_nombre ?? "",
    contacto_telefono: sucursal?.contacto_telefono ?? "",
    contacto_correo: sucursal?.contacto_correo ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof SForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: "" }));
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveSucursalAction(parentId, sucursal?.id ?? null, v);
      if (!r.ok) {
        setError(r.error);
        setErrors(("fields" in r && r.fields) || {});
        return;
      }
      onSaved(r.customer);
    });
  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Título de la sucursal *" error={errors.sucursal}>
          <Input value={v.sucursal} onChange={set("sucursal")} autoFocus={!sucursal} placeholder="Ej. Sucursal Delicias" />
        </Field>
        <Field label="Estado *" error={errors.estado_geo}>
          <Select value={v.estado_geo} onChange={set("estado_geo")}>
            <option value="">Elige...</option>
            {ESTADOS_MX.map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Dirección *" error={errors.direccion}>
            <textarea value={v.direccion} onChange={set("direccion")} rows={2} className={area} placeholder="Calle, número, colonia, ciudad, C.P." />
          </Field>
        </div>
        <Field label="Persona de contacto" error={errors.contacto_nombre}>
          <Input value={v.contacto_nombre} onChange={set("contacto_nombre")} placeholder="Ej. Pedro Ruiz (Almacén)" />
        </Field>
        <Field label="Teléfono / WhatsApp" error={errors.contacto_telefono}>
          <Input value={v.contacto_telefono} onChange={set("contacto_telefono")} type="tel" inputMode="tel" />
        </Field>
        <Field label="Correo" error={errors.contacto_correo}>
          <Input value={v.contacto_correo} onChange={set("contacto_correo")} type="email" inputMode="email" />
        </Field>
      </div>
      <p className="text-xs text-slate-500">La razón social, RFC y giro son los del cliente principal. La sucursal cuenta como cliente aparte en ventas, bitácora y encuesta.</p>
      <div className="flex gap-2">
        <Button type="button" loading={pending} onClick={save}>{sucursal ? "Guardar sucursal" : "Agregar sucursal"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>}
      </div>
    </div>
  );
}

/** Sucursales del cliente: lista y boton para agregar otra direccion con titulo. */
export function SucursalesPanel({ parent }: { parent: CustomerRecord }) {
  const [list, setList] = useState<CustomerRecord[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  useEffect(() => {
    let alive = true;
    listSucursalesAction(parent.id).then((r) => alive && setList(r));
    return () => {
      alive = false;
    };
  }, [parent.id]);
  const saved = (c: CustomerRecord) => {
    setList((l) => (l?.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...(l ?? []), c]));
    setEditing(null);
  };
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800">Sucursales {list && list.length > 0 && <span className="font-normal text-slate-500">({list.length})</span>}</p>
        {editing !== "new" && (
          <Button type="button" variant="secondary" className="text-xs" onClick={() => setEditing("new")}>
            <Icon name="plus" className="h-4 w-4" /> Agregar sucursal
          </Button>
        )}
      </div>
      {list === null ? (
        <Spinner />
      ) : list.length === 0 && editing !== "new" ? (
        <p className="text-xs text-slate-500">¿El cliente tiene otra dirección (por ejemplo, otra planta o ciudad)? Agrégala como sucursal.</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {list.map((c) => (
            <li key={c.id} className="py-2">
              {editing === c.id ? (
                <SucursalForm parentId={parent.id} sucursal={c} onSaved={saved} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex items-start justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{c.sucursal}</p>
                    <p className="truncate text-xs text-slate-500">{[c.direccion, c.estado_geo].filter(Boolean).join(" · ")}</p>
                    <p className="truncate text-xs text-slate-600">{[c.contacto_nombre, c.contacto_telefono, c.contacto_correo].filter(Boolean).join(" · ")}</p>
                  </div>
                  <Button type="button" variant="ghost" className="text-xs" onClick={() => setEditing(c.id)}>Editar</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === "new" && (
        <div className="rounded-md border border-brand-100 bg-white p-3">
          <SucursalForm parentId={parent.id} defaultEstado={parent.estado_geo ?? ""} onSaved={saved} onCancel={() => setEditing(null)} />
        </div>
      )}
    </div>
  );
}

/** Ventana para dar de alta un cliente (fuera de cualquier formulario de la pantalla) y luego sus sucursales. */
export function CustomerModal({
  initialName = "",
  onClose,
  onPicked,
}: {
  initialName?: string;
  onClose: () => void;
  /** Si se da, al guardar se ofrece "Usar este cliente". */
  onPicked?: (c: CustomerRecord) => void;
}) {
  const [saved, setSaved] = useState<CustomerRecord | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Agregar cliente" className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl sm:max-w-2xl sm:rounded-xl sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{saved ? "Cliente dado de alta" : "Agregar cliente o prospecto"}</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
          </button>
        </div>
        {saved ? (
          <div className="space-y-3">
            <Alert tone="success">&quot;{saved.nombre}&quot; quedó guardado. Ya lo puedes elegir en ventas, guías, quejas y solicitudes.</Alert>
            <SucursalesPanel parent={saved} />
            <div className="flex flex-wrap gap-2">
              {onPicked ? (
                <Button type="button" onClick={() => onPicked(saved)}>Usar este cliente</Button>
              ) : (
                <Button type="button" onClick={onClose}>Listo</Button>
              )}
              <Button type="button" variant="secondary" onClick={() => setSaved(null)}>Agregar otro</Button>
            </div>
          </div>
        ) : (
          <CustomerForm initialName={initialName} onSaved={onPicked ? (c) => onPicked(c) : setSaved} onCancel={onClose} />
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Boton "Agregar cliente" de la barra: alta desde cualquier pantalla. */
export function AddCustomerButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Agregar cliente"
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-600 px-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50 sm:px-3"
      >
        <Icon name="plus" className="h-4 w-4" />
        <span className="hidden sm:inline">Cliente</span>
      </button>
      {open && <CustomerModal onClose={close} />}
    </>
  );
}

function CustomerSummary({ c, missing }: { c: CustomerRecord; missing?: string[] }) {
  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-slate-900">
        {c.nombre}
        <KindBadge tipo={c.tipo} />
        {c.rfc && <span className="font-mono text-xs font-normal text-slate-500">{c.rfc}</span>}
        {!c.activo && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">Inactivo</span>}
      </p>
      <p className="truncate text-xs text-slate-500">{[c.giro, c.estado_geo, c.razon_social].filter(Boolean).join(" · ")}</p>
      <p className="truncate text-xs text-slate-600">{[c.contacto_nombre, c.contacto_telefono, c.contacto_correo].filter(Boolean).join(" · ") || "Sin contacto"}</p>
      {missing && missing.length > 0 && <p className="text-xs font-medium text-amber-800">Falta: {missing.join(", ")}</p>}
    </div>
  );
}

/** Buscador de clientes (sin mostrar la lista completa): minimo 2 letras. */
export function useCustomerSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CustomerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchCustomersAction(term);
      if (n === seq.current) {
        setResults(r);
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return { q, setQ, results, loading };
}

function SearchBox({ q, setQ, loading, placeholder }: { q: string; setQ: (v: string) => void; loading: boolean; placeholder: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        {loading ? <Spinner className="h-4 w-4" /> : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
      </span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" autoComplete="off" />
    </div>
  );
}

/**
 * Elegir el cliente (solicitud o bitacora): buscador o alta. Muestra "Marcar como cliente" si es prospecto.
 * `requireForQuote`: marca lo que falta para poder enviar una solicitud (RFC, direccion, contacto).
 */
export function CustomerPicker({
  value,
  onChange,
  requireForQuote = true,
  defaultKind = "cliente",
}: {
  value: CustomerRecord | null;
  onChange: (c: CustomerRecord | null) => void;
  requireForQuote?: boolean;
  defaultKind?: CustomerKind;
}) {
  const { q, setQ, results, loading } = useCustomerSearch();
  const [mode, setMode] = useState<"search" | "new" | "edit">("search");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const pick = (c: CustomerRecord) => {
    onChange(c);
    setMode("search");
    setQ("");
  };

  if (mode === "new" || (mode === "edit" && value)) {
    return (
      <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
        <p className="text-sm font-semibold text-slate-800">{mode === "new" ? "Dar de alta" : "Completar datos"}</p>
        <CustomerForm customer={mode === "edit" ? value : null} initialName={q} initialKind={defaultKind} onSaved={pick} onCancel={() => setMode("search")} />
      </div>
    );
  }

  if (value) {
    const missing = requireForQuote ? customerMissing(value) : [];
    return (
      <div className="space-y-2">
        <div className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${missing.length ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <CustomerSummary c={value} missing={missing} />
          <div className="flex shrink-0 flex-wrap gap-2">
            {value.tipo === "prospecto" && (
              <Button
                type="button"
                className="bg-green-600 text-xs hover:bg-green-700"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const r = await convertCustomerAction(value.id);
                    if (r.ok) onChange(r.customer);
                    else setErr(r.error);
                  })
                }
              >
                Ya es cliente
              </Button>
            )}
            <Button type="button" variant={missing.length ? "primary" : "secondary"} className="text-xs" onClick={() => setMode("edit")}>
              {missing.length ? "Completar datos" : "Editar"}
            </Button>
            <Button type="button" variant="ghost" className="text-xs" onClick={() => onChange(null)}>Cambiar</Button>
          </div>
        </div>
        {value.tipo === "prospecto" && <p className="text-xs text-sky-800">Es prospecto. Si ya te compró, márcalo como cliente: se registra la conversión.</p>}
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <SearchBox q={q} setQ={setQ} loading={loading} placeholder="Busca por nombre, RFC, contacto o teléfono (mínimo 2 letras)" />
      {q.trim().length >= 2 && (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => pick(c)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50">
                <CustomerSummary c={c} />
                <span className="shrink-0 text-xs font-medium text-brand-600">Elegir</span>
              </button>
            </li>
          ))}
          {!loading && results.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No hay clientes con &quot;{q}&quot;</li>}
        </ul>
      )}
      <Button type="button" variant="secondary" onClick={() => setMode("new")} className="w-full sm:w-auto">
        <Icon name="plus" className="h-4 w-4" /> Dar de alta{q.trim() ? ` "${q.trim()}"` : " cliente o prospecto"}
      </Button>
    </div>
  );
}

/**
 * Pagina de clientes.
 * - Comprador y jefa de ventas: lista completa con filtros (clientes, prospectos, convertidos, incompletos).
 * - Vendedor: solo buscador (no ve la lista completa).
 */
export function ClientsDirectory({
  customers: initial,
  role,
  editCustomer,
}: {
  customers: CustomerRecord[];
  role: "comprador" | "jefe_ventas" | "vendedor" | "lectura";
  editCustomer?: CustomerRecord | null;
}) {
  const fullList = role !== "vendedor";
  const readOnly = role === "lectura";
  const [customers, setCustomers] = useState(initial);
  const [q, setQ] = useState("");
  const search = useCustomerSearch();
  const [filter, setFilter] = useState<"todos" | "cliente" | "prospecto" | "convertidos" | "incompletos" | "inactivos">("todos");
  const [editing, setEditing] = useState<string | "new" | null>(editCustomer ? editCustomer.id : null);
  const [extra, setExtra] = useState<CustomerRecord[]>(editCustomer ? [editCustomer] : []);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const counts = useMemo(
    () => ({
      cliente: customers.filter((c) => c.activo && c.tipo === "cliente").length,
      prospecto: customers.filter((c) => c.activo && c.tipo === "prospecto").length,
      convertidos: customers.filter((c) => c.tipo_inicial === "prospecto" && c.convertido_at).length,
      incompletos: customers.filter((c) => c.activo && customerMissing(c).length > 0).length,
    }),
    [customers],
  );
  const list = fullList
    ? customers.filter(
        (c) =>
          matchCustomer(c, q) &&
          (filter === "todos" ? c.activo || role === "comprador"
            : filter === "inactivos" ? !c.activo
            : filter === "convertidos" ? c.tipo_inicial === "prospecto" && !!c.convertido_at
            : filter === "incompletos" ? c.activo && customerMissing(c).length > 0
            : c.activo && c.tipo === filter),
      )
    : [...extra.filter((e) => !search.results.some((r) => r.id === e.id)), ...search.results];

  const upsert = (c: CustomerRecord) => {
    setCustomers((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [c, ...l]));
    setExtra((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]));
    setEditing(null);
    setNotice(`"${c.nombre}" guardado.`);
  };
  const chips = [
    ["todos", `Todos (${counts.cliente + counts.prospecto})`],
    ["cliente", `Clientes (${counts.cliente})`],
    ["prospecto", `Prospectos (${counts.prospecto})`],
    ["convertidos", `Prospectos que se volvieron clientes (${counts.convertidos})`],
    ["incompletos", `Datos incompletos (${counts.incompletos})`],
    ...(role === "comprador" ? [["inactivos", "Inactivos"]] : []),
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{fullList ? "Clientes" : "Buscar cliente"}</h1>
          <p className="text-sm text-slate-500">
            {fullList ? "Base general de clientes y prospectos de ESC." : "Busca un cliente para ver o completar sus datos, o da de alta uno nuevo."}
          </p>
        </div>
        {!readOnly && (
          <Button onClick={() => setEditing("new")}>
            <Icon name="plus" className="h-4 w-4" /> Nuevo
          </Button>
        )}
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}

      {editing === "new" && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">Alta de cliente o prospecto</h2>
          <CustomerForm initialName={fullList ? q : search.q} onSaved={upsert} onCancel={() => setEditing(null)} />
        </Card>
      )}

      {fullList ? (
        <div className="space-y-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, RFC, giro, estado, contacto, teléfono o correo" />
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 text-xs sm:mx-0 sm:flex-wrap sm:px-0">
            {chips.map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f as typeof filter)}
                className={`shrink-0 rounded-full border px-3 py-1.5 font-medium ${filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <SearchBox q={search.q} setQ={search.setQ} loading={search.loading} placeholder="Escribe al menos 2 letras del nombre, RFC, contacto o teléfono" />
      )}

      <Card className="p-0">
        {list.length === 0 ? (
          <EmptyState title={fullList ? "Sin clientes en esta vista" : search.q.trim().length < 2 ? "Escribe para buscar" : "Sin resultados"}>
            {!fullList && "Por privacidad, la lista completa de clientes solo la ven compras y la jefa de ventas."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((c) => (
              <li key={c.id} className="px-3 py-3 sm:px-4">
                {editing === c.id ? (
                  <CustomerForm customer={c} onSaved={upsert} onCancel={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <CustomerSummary c={c} missing={customerMissing(c)} />
                      {c.convertido_at && <p className="mt-0.5 text-xs text-green-700">Se volvió cliente el {new Date(c.convertido_at).toLocaleDateString("es-MX", { dateStyle: "medium" })}</p>}
                    </div>
                    {!readOnly && <div className="flex shrink-0 flex-wrap gap-2">
                      {c.tipo === "prospecto" && (
                        <Button
                          className="bg-green-600 text-xs hover:bg-green-700"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await convertCustomerAction(c.id);
                              if (r.ok) upsert(r.customer);
                              else setNotice(r.error);
                            })
                          }
                        >
                          Ya es cliente
                        </Button>
                      )}
                      {c.tipo === "cliente" && role !== "vendedor" && (
                        <Button
                          variant="ghost"
                          className="text-xs"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await setCustomerKindAction(c.id, "prospecto");
                              if (r.ok) upsert({ ...c, tipo: "prospecto", convertido_at: null });
                              else setNotice(r.error);
                            })
                          }
                        >
                          Regresar a prospecto
                        </Button>
                      )}
                      <Button variant="secondary" className="text-xs" onClick={() => setEditing(c.id)}>
                        {customerMissing(c).length ? "Completar" : "Editar"}
                      </Button>
                      {role === "comprador" && (
                        <Button
                          variant="ghost"
                          className="text-xs"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await setCustomerActiveAction(c.id, !c.activo);
                              if (r.ok) setCustomers((l) => l.map((x) => (x.id === c.id ? { ...x, activo: !c.activo } : x)));
                              else setNotice(r.error);
                            })
                          }
                        >
                          {c.activo ? "Desactivar" : "Reactivar"}
                        </Button>
                      )}
                    </div>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
