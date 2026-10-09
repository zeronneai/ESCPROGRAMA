"use client";

import { useState, useTransition } from "react";
import { createCustomerBuyerAction, updateCustomerAction } from "@/actions/config";
import type { Result } from "@/actions/requests";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";

interface C { id: string; nombre: string; tipo: "cliente" | "prospecto"; activo: boolean }

export function ClientsPanel({ customers }: { customers: C[] }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ nombre: "", tipo: "cliente" });
  const [edit, setEdit] = useState<C | null>(null);

  function run(fn: () => Promise<Result>, after?: () => void) {
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (r.ok) { setNotice({ tone: "success", text: "Listo" }); after?.(); }
      else setNotice({ tone: "error", text: r.error });
    });
  }

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">Clientes</h1>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); run(() => createCustomerBuyerAction(form), () => setForm({ nombre: "", tipo: "cliente" })); }}
        >
          <Field label="Nombre"><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Field>
          <Field label="Tipo">
            <Select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}>
              <option value="cliente">Cliente actual</option>
              <option value="prospecto">Prospecto</option>
            </Select>
          </Field>
          <Button type="submit" disabled={pending}>Agregar cliente</Button>
        </form>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-200">
                {edit?.id === c.id ? (
                  <>
                    <td className="px-3 py-2"><Input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></td>
                    <td className="px-3 py-2">
                      <Select value={edit.tipo} onChange={(e) => setEdit({ ...edit, tipo: e.target.value as C["tipo"] })}>
                        <option value="cliente">Cliente actual</option><option value="prospecto">Prospecto</option>
                      </Select>
                    </td>
                    <td className="px-3 py-2">{c.activo ? "Activo" : "Inactivo"}</td>
                    <td className="space-x-1 px-3 py-2 text-right">
                      <Button disabled={pending} onClick={() => run(() => updateCustomerAction(c.id, edit), () => setEdit(null))}>Guardar</Button>
                      <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">{c.nombre}</td>
                    <td className="px-3 py-2 capitalize">{c.tipo}</td>
                    <td className="px-3 py-2">{c.activo ? "Activo" : <span className="text-slate-500">Inactivo</span>}</td>
                    <td className="space-x-1 px-3 py-2 text-right">
                      <Button variant="ghost" onClick={() => setEdit(c)}>Editar</Button>
                      <Button variant="ghost" disabled={pending} onClick={() => run(() => updateCustomerAction(c.id, { nombre: c.nombre, tipo: c.tipo, activo: !c.activo }))}>
                        {c.activo ? "Desactivar" : "Reactivar"}
                      </Button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
