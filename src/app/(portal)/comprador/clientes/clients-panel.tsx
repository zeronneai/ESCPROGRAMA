"use client";

import { useState, useTransition } from "react";
import { createCustomerBuyerAction, updateCustomerAction } from "@/actions/config";
import type { Result } from "@/actions/requests";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

interface C { id: string; nombre: string; activo: boolean }

/** El cliente es solo el nombre de la empresa (sin correo, contacto ni tipo). */
export function ClientsPanel({ customers }: { customers: C[] }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [nombre, setNombre] = useState("");
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
      <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      <Card>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createCustomerBuyerAction({ nombre }), () => setNombre("")); }}>
          <Field label="Nombre de la empresa"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Field>
          <Button type="submit" loading={pending}>Agregar cliente</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Los vendedores también pueden agregar empresas nuevas al crear una solicitud.</p>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-200">
                {edit?.id === c.id ? (
                  <>
                    <td className="px-3 py-2"><Input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} /></td>
                    <td className="px-3 py-2">{c.activo ? "Activo" : "Inactivo"}</td>
                    <td className="space-x-1 px-3 py-2 text-right">
                      <Button loading={pending} onClick={() => run(() => updateCustomerAction(c.id, { nombre: edit.nombre, activo: c.activo }), () => setEdit(null))}>Guardar</Button>
                      <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2">{c.nombre}</td>
                    <td className="px-3 py-2">{c.activo ? "Activo" : <span className="text-slate-500">Inactivo</span>}</td>
                    <td className="space-x-1 px-3 py-2 text-right">
                      <Button variant="ghost" onClick={() => setEdit(c)}>Editar</Button>
                      <Button variant="ghost" disabled={pending} onClick={() => run(() => updateCustomerAction(c.id, { nombre: c.nombre, activo: !c.activo }))}>
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
