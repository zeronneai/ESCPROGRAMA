"use client";

import { useMemo, useState, useTransition } from "react";
import { saveCustomerAction, setCustomerActiveAction } from "@/actions/customers";
import { Icon } from "@/components/icons";
import { Alert, Button, Card, EmptyState, Field, Input } from "@/components/ui";
import { customerMissing, matchCustomer, RFC_EXTRANJERO, type CustomerRecord } from "@/lib/validation/customer";

type Form = Record<"nombre" | "razon_social" | "rfc" | "direccion" | "contacto_nombre" | "contacto_telefono" | "contacto_correo", string>;
const toForm = (c?: Partial<CustomerRecord> | null, nombre = ""): Form => ({
  nombre: c?.nombre ?? nombre,
  razon_social: c?.razon_social ?? "",
  rfc: c?.rfc ?? "",
  direccion: c?.direccion ?? "",
  contacto_nombre: c?.contacto_nombre ?? "",
  contacto_telefono: c?.contacto_telefono ?? "",
  contacto_correo: c?.contacto_correo ?? "",
});

const area = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";

/** Alta o edicion de un cliente de la base general. */
export function CustomerForm({
  customer,
  initialName = "",
  onSaved,
  onCancel,
}: {
  customer?: CustomerRecord | null;
  initialName?: string;
  onSaved: (c: CustomerRecord) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<Form>(() => toForm(customer, initialName));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: "" }));
  };
  function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    start(async () => {
      const r = await saveCustomerAction(customer?.id ?? null, v);
      if (!r.ok) {
        setError(r.error);
        setErrors(("fields" in r && r.fields) || {});
        return;
      }
      onSaved(r.customer);
    });
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre del cliente (como lo conocen) *" error={errors.nombre}>
          <Input value={v.nombre} onChange={set("nombre")} autoFocus={!customer} placeholder="Ej. Foxconn Planta 3" />
        </Field>
        <Field label="Razón social" error={errors.razon_social}>
          <Input value={v.razon_social} onChange={set("razon_social")} placeholder="Como aparece en la factura" />
        </Field>
        <Field label="RFC *" error={errors.rfc}>
          <Input value={v.rfc} onChange={set("rfc")} className="font-mono uppercase" maxLength={16} placeholder="ABC010101AB1" />
          <span className="block text-[11px] text-slate-500">
            Cliente extranjero:{" "}
            <button type="button" className="underline" onClick={() => setV((s) => ({ ...s, rfc: RFC_EXTRANJERO }))}>{RFC_EXTRANJERO}</button>
          </span>
        </Field>
        <Field label="Persona de contacto" error={errors.contacto_nombre}>
          <Input value={v.contacto_nombre} onChange={set("contacto_nombre")} placeholder="Ej. Laura Méndez (Compras)" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Dirección *" error={errors.direccion}>
            <textarea value={v.direccion} onChange={set("direccion")} rows={2} className={area} placeholder="Calle, número, colonia, ciudad, estado, C.P." />
          </Field>
        </div>
        <Field label="Teléfono / WhatsApp" error={errors.contacto_telefono}>
          <Input value={v.contacto_telefono} onChange={set("contacto_telefono")} type="tel" inputMode="tel" placeholder="614 123 4567" />
        </Field>
        <Field label="Correo" error={errors.contacto_correo}>
          <Input value={v.contacto_correo} onChange={set("contacto_correo")} type="email" inputMode="email" placeholder="compras@cliente.com" />
        </Field>
      </div>
      <p className="text-xs text-slate-500">* Obligatorios. Además, al menos teléfono o correo (sirven para mandar la cotización).</p>
      <div className="flex gap-2">
        <Button type="submit" loading={pending}>{customer ? "Guardar cliente" : "Dar de alta"}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>}
      </div>
    </form>
  );
}

function CustomerSummary({ c }: { c: CustomerRecord }) {
  const missing = customerMissing(c);
  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <p className="font-medium text-slate-900">
        {c.nombre}
        {c.rfc && <span className="ml-2 font-mono text-xs text-slate-500">{c.rfc}</span>}
        {!c.activo && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600">Inactivo</span>}
      </p>
      {c.razon_social && <p className="truncate text-xs text-slate-500">{c.razon_social}</p>}
      <p className="truncate text-xs text-slate-600">{[c.contacto_nombre, c.contacto_telefono, c.contacto_correo].filter(Boolean).join(" · ") || "Sin contacto"}</p>
      {missing.length > 0 && <p className="text-xs font-medium text-amber-800">Falta: {missing.join(", ")}</p>}
    </div>
  );
}

/** Elegir el cliente de una solicitud: buscador en la base general o alta de uno nuevo. */
export function CustomerPicker({
  customers: initial,
  value,
  onChange,
}: {
  customers: CustomerRecord[];
  value: string;
  onChange: (c: CustomerRecord | null) => void;
}) {
  const [customers, setCustomers] = useState(initial);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"search" | "new" | "edit">(value ? "search" : "search");
  const selected = customers.find((c) => c.id === value) ?? null;
  const results = useMemo(() => customers.filter((c) => c.activo && matchCustomer(c, q)).slice(0, 8), [customers, q]);

  const upsert = (c: CustomerRecord) => {
    setCustomers((list) => (list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c].sort((a, b) => a.nombre.localeCompare(b.nombre))));
    onChange(c);
    setMode("search");
    setQ("");
  };

  if (mode === "new" || (mode === "edit" && selected)) {
    return (
      <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
        <p className="text-sm font-semibold text-slate-800">{mode === "new" ? "Dar de alta cliente" : "Completar datos del cliente"}</p>
        <CustomerForm customer={mode === "edit" ? selected : null} initialName={q} onSaved={upsert} onCancel={() => setMode("search")} />
      </div>
    );
  }

  if (selected) {
    const missing = customerMissing(selected);
    return (
      <div className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${missing.length ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
        <CustomerSummary c={selected} />
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant={missing.length ? "primary" : "secondary"} className="text-xs" onClick={() => setMode("edit")}>
            {missing.length ? "Completar datos" : "Editar"}
          </Button>
          <Button type="button" variant="ghost" className="text-xs" onClick={() => onChange(null)}>Cambiar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </span>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre, RFC, contacto o teléfono" className="pl-9" autoComplete="off" />
      </div>
      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {results.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onChange(c)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-50">
              <CustomerSummary c={c} />
              <span className="shrink-0 text-xs font-medium text-brand-600">Elegir</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">{q ? `No hay clientes con "${q}"` : "Aún no hay clientes en la base"}</li>}
      </ul>
      <Button type="button" variant="secondary" onClick={() => setMode("new")} className="w-full sm:w-auto">
        <Icon name="plus" className="h-4 w-4" /> Dar de alta cliente{q ? ` "${q}"` : ""}
      </Button>
    </div>
  );
}

/** Pagina de clientes (vendedor y comprador): base general con buscador. */
export function ClientsDirectory({ customers: initial, isBuyer, editId }: { customers: CustomerRecord[]; isBuyer: boolean; editId?: string }) {
  const [customers, setCustomers] = useState(initial);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"todos" | "incompletos" | "inactivos">("todos");
  const [editing, setEditing] = useState<string | "new" | null>(editId && initial.some((c) => c.id === editId) ? editId : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const list = customers.filter(
    (c) =>
      matchCustomer(c, q) &&
      (filter === "todos" ? c.activo || isBuyer : filter === "incompletos" ? customerMissing(c).length > 0 && c.activo : !c.activo),
  );
  const incompletos = customers.filter((c) => c.activo && customerMissing(c).length > 0).length;
  const upsert = (c: CustomerRecord) => {
    setCustomers((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [c, ...l]));
    setEditing(null);
    setNotice(`Cliente "${c.nombre}" guardado.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-slate-500">Base general de clientes de ESC. Todos los vendedores la comparten.</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Icon name="plus" className="h-4 w-4" /> Nuevo cliente
        </Button>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}

      {editing === "new" && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 font-semibold">Nuevo cliente</h2>
          <CustomerForm initialName={q} onSaved={upsert} onCancel={() => setEditing(null)} />
        </Card>
      )}

      <div className="space-y-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, RFC, contacto, teléfono o correo" />
        <div className="flex flex-wrap gap-2 text-xs">
          {(["todos", "incompletos", ...(isBuyer ? (["inactivos"] as const) : [])] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1.5 font-medium ${filter === f ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"}`}
            >
              {f === "todos" ? `Todos (${customers.filter((c) => c.activo || isBuyer).length})` : f === "incompletos" ? `Datos incompletos (${incompletos})` : "Inactivos"}
            </button>
          ))}
        </div>
      </div>

      <Card className="p-0">
        {list.length === 0 ? (
          <EmptyState title="Sin clientes en esta vista" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((c) => (
              <li key={c.id} className="px-3 py-3 sm:px-4">
                {editing === c.id ? (
                  <CustomerForm customer={c} onSaved={upsert} onCancel={() => setEditing(null)} />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <CustomerSummary c={c} />
                      {c.direccion && <p className="mt-0.5 truncate text-xs text-slate-500">{c.direccion}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant={customerMissing(c).length ? "primary" : "secondary"} className="text-xs" onClick={() => setEditing(c.id)}>
                        {customerMissing(c).length ? "Completar" : "Editar"}
                      </Button>
                      {isBuyer && (
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
                    </div>
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
