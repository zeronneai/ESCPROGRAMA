"use client";
import { useState, useTransition } from "react";
import {
  createUserAction,
  resetPasswordAction,
  setUserActiveAction,
  updateUserNameAction,
  type UserActionResult,
} from "@/actions/users";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { generateTempPassword } from "@/lib/auth/password";

export interface UserRow {
  id: string;
  nombre: string;
  correo: string;
  rol: "vendedor" | "comprador";
  activo: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Nunca";

export function UsersPanel({ users, meId }: { users: UserRow[]; meId: string }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [secret, setSecret] = useState<{ para: string; password: string } | null>(null);
  const [form, setForm] = useState({ nombre: "", correo: "", password: "", comprador: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; nombre: string } | null>(null);

  function run(fn: () => Promise<UserActionResult>, para?: string, onOk?: () => void) {
    setNotice(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setErrors(r.fieldErrors ?? {});
        setNotice({ tone: "error", text: r.error });
        return;
      }
      setErrors({});
      onOk?.();
      if (r.tempPassword && para) setSecret({ para, password: r.tempPassword });
      else setNotice({ tone: "success", text: "Listo" });
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight">Usuarios</h1>

      {secret && (
        <Alert tone="info">
          <p className="font-medium">Contraseña temporal para {secret.para}</p>
          <p className="mt-1">
            Cópiala ahora: no se vuelve a mostrar. Al entrar, el usuario deberá cambiarla.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 text-base">{secret.password}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(secret.password)}>
              Copiar
            </Button>
            <Button variant="ghost" onClick={() => setSecret(null)}>
              Ya la copié
            </Button>
          </div>
        </Alert>
      )}
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <Card>
        <h2 className="mb-3 font-medium">Crear usuario</h2>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createUserAction(form), form.nombre, () =>
              setForm({ nombre: "", correo: "", password: "", comprador: false }),
            );
          }}
        >
          <Field label="Nombre" error={errors.nombre}>
            <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required />
          </Field>
          <Field label="Correo" error={errors.correo}>
            <Input
              type="email"
              value={form.correo}
              onChange={(e) => setForm({ ...form, correo: e.target.value })}
              required
            />
          </Field>
          <Field label="Contraseña temporal" error={errors.password}>
            <div className="flex gap-2">
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete="off"
                required
              />
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                onClick={() => setForm({ ...form, password: generateTempPassword() })}
              >
                Generar contraseña
              </Button>
            </div>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={form.comprador}
              onChange={(e) => setForm({ ...form, comprador: e.target.checked })}
            />
            Crear como comprador (administrador del sistema)
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" loading={pending}>
              Crear {form.comprador ? "comprador" : "vendedor"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Correo</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Ultimo acceso</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-200">
                <td className="px-3 py-2">
                  {editing?.id === u.id ? (
                    <form
                      className="flex gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(() => updateUserNameAction(u.id, editing.nombre), undefined, () => setEditing(null));
                      }}
                    >
                      <Input value={editing.nombre} onChange={(e) => setEditing({ id: u.id, nombre: e.target.value })} />
                      <Button type="submit" loading={pending}>
                        Guardar
                      </Button>
                    </form>
                  ) : (
                    u.nombre
                  )}
                </td>
                <td className="px-3 py-2">{u.correo}</td>
                <td className="px-3 py-2 capitalize">{u.rol}</td>
                <td className="px-3 py-2">
                  {u.activo ? (
                    <span className="text-green-700">Activo</span>
                  ) : (
                    <span className="text-slate-500">Desactivado</span>
                  )}
                  {u.activo && u.must_change_password && (
                    <span className="ml-2 text-xs text-amber-700">(debe cambiar contraseña)</span>
                  )}
                </td>
                <td className="px-3 py-2">{fmt(u.last_login_at)}</td>
                <td className="space-x-1 px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="ghost" onClick={() => setEditing({ id: u.id, nombre: u.nombre })}>
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending || !u.activo}
                    onClick={() => {
                      if (confirm(`Restablecer la contraseña de ${u.nombre}?`))
                        run(() => resetPasswordAction(u.id), u.nombre);
                    }}
                  >
                    Restablecer contraseña
                  </Button>
                  {u.id !== meId && (
                    <Button
                      variant={u.activo ? "danger" : "secondary"}
                      disabled={pending}
                      onClick={() => {
                        const verb = u.activo ? "desactivar" : "reactivar";
                        if (confirm(`Seguro que quieres ${verb} a ${u.nombre}?`))
                          run(() => setUserActiveAction(u.id, !u.activo));
                      }}
                    >
                      {u.activo ? "Desactivar" : "Reactivar"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
