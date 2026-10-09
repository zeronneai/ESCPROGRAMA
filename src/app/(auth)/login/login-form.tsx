"use client";
import { useActionState } from "react";
import { loginAction, type FormState } from "@/actions/auth";
import { Alert, Button, Field, Input } from "@/components/ui";

export function LoginForm({ inactive }: { inactive?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      {inactive && <Alert tone="error">Tu usuario esta desactivado. Contacta al administrador.</Alert>}
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field label="Correo">
        <Input name="correo" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Contraseña">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}
