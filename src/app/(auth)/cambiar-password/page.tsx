import { Card } from "@/components/ui";
import { Logo } from "@/components/logo";
import { ChangePasswordForm } from "./change-password-form";

export default function ChangePasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="h-12" />
        <h1 className="text-lg font-semibold">Cambia tu contraseña</h1>
        <p className="text-sm text-slate-600">
          Por seguridad debes elegir una contraseña nueva antes de usar el portal.
        </p>
      </div>
      <Card>
        <ChangePasswordForm />
      </Card>
      <form action="/api/auth/logout" method="post" className="text-center">
        <button className="text-sm text-slate-600 underline">Cerrar sesion</button>
      </form>
    </main>
  );
}
