/**
 * Crea el primer comprador-administrador (necesario para poder entrar).
 * Uso: pnpm bootstrap:admin -- "Nombre" correo@empresa.com 'ContraseñaSegura1'
 * Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno.
 */
import { createClient } from "@supabase/supabase-js";

const [nombre, correo, password] = process.argv.slice(2).filter((a) => a !== "--");
if (!nombre || !correo || !password) {
  console.error('Uso: pnpm bootstrap:admin -- "Nombre" correo@empresa.com \'Contraseña1\'');
  process.exit(1);
}
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.error("La contraseña necesita 8+ caracteres con letras y numeros.");
  process.exit(1);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data, error } = await admin.auth.admin.createUser({
  email: correo.toLowerCase(),
  password,
  email_confirm: true,
});
if (error || !data.user) {
  console.error("No se pudo crear el usuario:", error?.message);
  process.exit(1);
}
const { error: pErr } = await admin.from("profiles").insert({
  id: data.user.id,
  nombre,
  correo: correo.toLowerCase(),
  rol: "comprador",
  must_change_password: false,
});
if (pErr) {
  await admin.auth.admin.deleteUser(data.user.id);
  console.error("No se pudo crear el perfil:", pErr.message);
  process.exit(1);
}
console.log(`Comprador creado: ${correo}`);
