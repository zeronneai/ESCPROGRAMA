import { Card } from "@/components/ui";
import { Logo } from "@/components/logo";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <Logo className="h-12" />
        <h1 className="text-lg font-semibold">Portal de cotizaciones</h1>
      </div>
      <Card>
        <LoginForm inactive={error === "inactivo"} />
      </Card>
    </main>
  );
}
