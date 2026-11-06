import { DateTime } from "luxon";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const h = DateTime.now().setZone("America/Chihuahua").hour;
  const saludo = h < 12 ? "¡Buenos días!" : h < 19 ? "¡Buenas tardes!" : "¡Buenas noches!";
  return (
    <AuthShell titulo={`${saludo} Qué gusto verte`} subtitulo="Bienvenido de nuevo. Entra con tu correo de ESC para seguir donde te quedaste.">
      <LoginForm inactive={error === "inactivo"} />
    </AuthShell>
  );
}
