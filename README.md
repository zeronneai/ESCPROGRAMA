# Portal de cotizaciones ESC Representaciones

Herramienta interna (con login) para solicitar, cotizar y dar seguimiento a cotizaciones, con trazabilidad para ISO 9001.

Estado: **Fase 1 (base)**. Ver `ROADMAP.md` para lo que sigue.

## Stack
Next.js 15 (App Router), TypeScript, Tailwind 4, Supabase (Postgres, Auth, Storage, RLS), Zod, React Hook Form, decimal.js, Luxon, Vitest.

## Instalacion local
```bash
pnpm install
cp .env.example .env.local        # llena las llaves de Supabase
supabase start                    # Supabase local (Docker) y aplica supabase/migrations
pnpm bootstrap:admin -- "Tu Nombre" tu@correo.com 'Clave1234'   # primer comprador
pnpm dev
```
En produccion, aplica las migraciones con `supabase db push` y crea el primer comprador con el mismo script.

## Alta de usuarios
Solo el comprador-administrador crea usuarios, en **Comprador > Usuarios**: nombre, correo y contraseña temporal (se puede generar). El usuario debe cambiarla en su primer acceso. Tambien se puede restablecer contraseña y desactivar o reactivar (nunca se borra).

## Pruebas
```bash
pnpm test        # unitarias: tabulador, horas habiles, formato de tabla, guardias de ruta
pnpm test:rls    # integridad y RLS contra Postgres (DATABASE_URL)
```
Para `test:rls` con Supabase local: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.
Sin Docker, `tests/rls/run-local-pg.sh` levanta un Postgres temporal con un shim minimo de Supabase y aplica las migraciones; imprime el `DATABASE_URL` a usar.

## Seguridad
- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en servidor (`src/lib/supabase/admin.ts`, con `server-only`) y siempre despues de `requireBuyer()`.
- El vendedor nunca puede leer costos: viven en `item_costs`, con RLS solo para comprador.
- Una partida cotizada es inmutable por triggers en la base de datos.
- `audit_log` es solo insercion (triggers); nada se borra de verdad.

## Cron en Vercel
El plan gratuito (Hobby) solo permite cron **una vez al dia**. "Vencida" se calcula al consultar a partir de `due_at`; el cron diario solo genera avisos dentro del portal.
