# Portal de cotizaciones ESC Representaciones

Herramienta interna (con login) para solicitar, cotizar y dar seguimiento a cotizaciones, con trazabilidad para ISO 9001.

Estado: **Fase 3** (dashboards, notificaciones, exportaciones, auditoria, configuracion). Ver `ROADMAP.md` para lo que sigue.

## Stack
Next.js 15 (App Router), TypeScript, Tailwind 4, Supabase (Postgres, Auth, Storage, RLS), Zod, React Hook Form, decimal.js, Luxon, Vitest.

## Puesta en marcha (todo desde el navegador, sin terminal)

1. **Supabase**: crea un proyecto nuevo.
2. **Base de datos**: SQL Editor > New query > pega todo `supabase/instalar-todo.sql` > Run. Crea tablas, seguridad (RLS), triggers, funciones y el bucket privado de imagenes.
3. **Primer usuario**: Authentication > Users > Add user > Create new user (correo y contrasena, marca *Auto Confirm User*). Luego abre `supabase/primer-comprador.sql`, cambia solo el correo y el nombre, y ejecutalo en SQL Editor.
4. **Auth**: Authentication > Sign In / Providers > Email: desactiva *Allow new users to sign up* (los usuarios los da de alta el comprador). En URL Configuration pon la URL de Vercel como *Site URL*.
5. **Vercel**: importa el repositorio y agrega las variables de entorno de la tabla de abajo. Despliega.
6. Entra al portal con el usuario del paso 3. Los demas usuarios se crean en **Comprador > Usuarios**.

### Variables de entorno (Vercel > Project > Settings > Environment Variables)

| Variable | Tipo | Donde la sacas en Supabase |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Publica | Project Settings > API > *Project URL* (`https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publica | Project Settings > API Keys > clave `anon` / *Publishable key* |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secreta** | Project Settings > API Keys > clave `service_role` / *Secret key* (no la compartas ni la pongas en `NEXT_PUBLIC_`) |
| `CRON_SECRET` | **Secreta** (fase 3) | No viene de Supabase: inventa una cadena aleatoria de 32+ caracteres |

`CRON_SECRET` ya se usa: Vercel la envia al cron diario de avisos (`vercel.json`).

### Actualizar la base de datos despues de instalar
`instalar-todo.sql` esta **congelado** (no se vuelve a pegar). Los cambios nuevos llegan como archivos numerados en `supabase/actualizaciones/`: pegalos en el SQL Editor **en orden**, una vez cada uno. Ver `supabase/actualizaciones/README.md`.

### Datos de demostracion (opcional)
Con al menos un comprador y un vendedor creados, pega `supabase/seed-demo.sql` en el SQL Editor: carga 8 clientes y 15 solicitudes en distintos estados. Solo para pruebas.

## Desarrollo local (opcional)
```bash
pnpm install && cp .env.example .env.local
supabase start        # Supabase local (Docker), aplica supabase/migrations
pnpm dev
```

## Alta de usuarios
Solo el comprador-administrador crea usuarios, en **Comprador > Usuarios**: nombre, correo y contraseña temporal (se puede generar y se muestra una sola vez). El usuario debe cambiarla en su primer acceso. Tambien se puede restablecer contraseña y desactivar o reactivar (nunca se borra).

## Modelo de cotizaciones (pensado para crecer)
- Cada cotizacion es una **version** (`item_costs` y `item_quotes` con llave `(item_id, version)`). Hoy solo existe la version 1; una revision futura agrega la 2, sin editar nada existente.
- `respond_item(item, accion, payload jsonb)` es el unico punto de entrada para responder; campos nuevos se agregan al payload sin cambiar la firma.
- `item_quotes.valid_until` esta reservado para la vigencia.
- El resultado (ganada o perdida), aclaraciones e historial de precios iran en tablas aparte, sin tocar el flujo de estados de la partida.

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

## Que incluye
- **Vendedor:** contadores, filtros por estado, cliente y fecha, alerta de respondidas sin enviar, linea de tiempo por solicitud.
- **Comprador:** bandeja con semaforo, estadisticas con graficas y filtros (fechas, vendedor, cliente, moneda), exportacion a Excel y CSV, reporte de auditoria exportable, clientes, usuarios y configuracion (factores con historial, plazos, zona horaria, festivos).
- **Notificaciones:** campana con contador y conteo en el titulo de la pestana (solo dentro del portal).

## Cron en Vercel
El plan gratuito (Hobby) solo permite cron **una vez al dia**. "Vencida" se calcula al consultar a partir de `due_at`; el cron diario solo genera avisos dentro del portal.
