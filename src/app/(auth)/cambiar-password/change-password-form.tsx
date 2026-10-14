"use client";
import { useActionState } from "react";
import { changePasswordAction, type FormState } from "@/actions/auth";
import { Alert, Button, Field, Input } from "@/components/ui";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(changePasswordAction, {});
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field label="Contraseña actual (la temporal)" error={fe.actual}>
        <Input name="actual" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="Contraseña nueva" error={fe.nueva}>
        <Input name="nueva" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <p className="text-xs text-slate-500">Minimo 8 caracteres, con letras y numeros.</p>
      <Field label="Confirma la contraseña nueva" error={fe.confirmar}>
        <Input name="confirmar" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" className="w-full" loading={pending}>
        {pending ? "Guardando..." : "Guardar contraseña"}
      </Button>
    </form>
  );
}
