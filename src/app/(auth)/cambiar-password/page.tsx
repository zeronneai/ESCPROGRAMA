import { AuthShell } from "@/components/auth-shell";
import { ChangePasswordForm } from "./change-password-form";

export default function ChangePasswordPage() {
  return (
    <AuthShell
      titulo="Bienvenido a ESC One"
      subtitulo="Antes de empezar, elige una contraseña nueva que solo tú conozcas."
      pie={
        <form action="/api/auth/logout" method="post">
          <button className="text-sm text-slate-600 underline">Cerrar sesión</button>
        </form>
      }
    >
      <ChangePasswordForm />
    </AuthShell>
  );
}
