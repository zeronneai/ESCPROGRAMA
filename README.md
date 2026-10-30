# Portal de cotizaciones ESC Representaciones

Herramienta interna (con login) para solicitar, cotizar y dar seguimiento a cotizaciones, con trazabilidad para ISO 9001.

Estado: **Fase 4** (vigencia y revisiones, resultado ganada o perdida, historial de precios, aclaraciones, PDF de cotizacion y abastecimiento). Ver `ROADMAP.md` para lo que sigue.

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
| `LEADS_WEBHOOK_SECRET` | **Secreta** (opcional) | Para la entrada de leads del sitio web. Inventa una cadena aleatoria de 32+ caracteres |

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

## Fase 4
- **Vigencia y revisiones:** cada cotizacion vale 15 dias naturales (configurable). Al vencer, el vendedor ve "Vigencia vencida" y puede **Solicitar actualizacion**; el comprador responde con **Confirmar sin cambios** o **Actualizar costo**. La version original nunca se edita: cada actualizacion es una version nueva (v2, v3) con folio `...-R2`.
- **Resultado:** despues de "Enviado al cliente" el vendedor marca Ganada, Perdida (con motivo) o Sin respuesta. Indicadores de conversion en las estadisticas.
- **Historial de precios** (solo comprador): cotizaciones parecidas por nombre, grafica de costo en el tiempo, catalogo de proveedores.
- **Aclaraciones:** chat por partida con imagen opcional. "Pedir aclaracion" pausa el reloj de 48 horas habiles hasta que el vendedor responda.
- **PDF de cotizacion** para el cliente: boton "Descargar PDF" por solicitud. Muestra solo el precio elegido por partida, nunca los 5 precios, costos ni proveedor. Todos los precios son **sin IVA** (el pie lleva la leyenda editable "16% VAT will be added to the invoice"; no se calculan impuestos). El **envío al cliente** (opcional) va **dentro del precio unitario**: el PDF no lo muestra como renglón ni lo desglosa, solo el costo final. El vendedor lo captura en "Datos del PDF" en tres modos: *por unidad* (se suma al precio unitario de cada partida), *por todo el pedido* (monto repartido entre las partidas en proporción a su importe y, dentro de cada una, entre sus unidades) y *por partida* (monto por unidad o total de la partida). Se suma al precio elegido, no cambia los 5 precios ni las respuestas del comprador, y la partida sin cantidad numérica cuenta como 1. El incremento por unidad se redondea a 2 decimales (decimal.js, método del mayor residuo en "por todo el pedido"), por lo que el total puede diferir del monto capturado por unos centavos; el cálculo vive en `src/lib/pricing/shipping-allocation.ts`. Si la solicitud mezcla pesos y dólares, el vendedor elige la moneda y solo esas partidas cambian. El pie lleva siempre, con destino capturado, la leyenda "Prices include shipping charges to your plant in <destino>, via <vía>" (editable en Configuración con {destino} y {via}). Lo ya guardado como envío aparte pasa a "por todo el pedido" (migración 0013). La plantilla vive en `src/lib/pdf/quote-template.tsx`.
- **Descripción y uso son internos.** El campo de la partida ("Para qué se usa / descripción (interno)") lo ven vendedor y comprador en las pantallas internas (detalle, historial, aclaraciones), pero nunca sale en el PDF ni en "Copiar tabla de precios". Al cliente solo llega el **nombre**: el panel "Datos del PDF" trae un campo "Nombre en el PDF" por partida (máx. 200 caracteres, se guarda por solicitud y versión, con bitácora), precargado con el producto solicitado o con el alternativo si el comprador cotizó uno. La tabla copiada usa ese mismo nombre.
- **Producto alternativo.** Al cotizar, el comprador elige "El precio corresponde a: producto solicitado / producto alternativo". El alternativo (nombre, presentación y por qué sirve para lo mismo) forma parte de la versión cotizada, queda bloqueado igual que el costo y el vendedor lo ve con un botón "Usar este nombre en el PDF". Proveedor y link siguen en "Dónde conseguirlo" (solo comprador). La búsqueda de cotizaciones parecidas y la búsqueda del vendedor consideran también descripción/uso (pg_trgm), y el historial muestra "Solicitado / Cotizado".
- **Compra mínima obligatoria.** Toda cotización nueva lleva compra mínima (cantidad ≥ 1 y unidad; por defecto 1 y la unidad de la partida; "si no hay mínimo, deja 1"). Queda bloqueada con la versión, igual que el costo. Las cotizaciones anteriores sin cantidad se asumen con mínimo 1 sin modificar nada; el monto mínimo queda como condición adicional opcional. El vendedor la ve siempre junto a los 5 precios, y si la cantidad pedida es menor al mínimo (misma unidad) la partida muestra "Cantidad pedida (X) menor al mínimo (Y)" en el detalle y en la lista. En "Datos del PDF" elige por partida *Cotizar a la cantidad mínima* (CANT y total sobre el mínimo) o *Mantener la cantidad pedida*; sin elegir no se descarga el PDF. La franja amarilla del PDF lista una línea "Minimum purchase: N unidad (producto)" por cada partida con mínimo mayor a 1 y no aparece si todas son 1; "Copiar tabla de precios" también incluye ese mínimo.
- **Abastecimiento** (solo comprador): "Donde conseguirlo (interno)" por partida y vista **Por comprar** con las cotizaciones ganadas.
- Pruebas manuales sugeridas: `docs/pruebas-manuales-fase-4.md`.

## PDF en Vercel (archivos de fuentes)
`@react-pdf/renderer` usa `pdfkit`, que carga sus fuentes estandar con un import map (`#standard-fonts/Helvetica`); el trazado de archivos de Next no lo detecta, asi que `next.config.ts` los incluye con `outputFileTracingIncludes` para `/api/pdf/[requestId]` (con pnpm viven en `node_modules/.pnpm/pdfkit@*/...`). `pnpm build` ejecuta `scripts/verify-pdf-trace.mjs`: comprueba que `Helvetica.cjs` y `HelveticaBold.cjs` esten en el trazado y genera un PDF usando solo los archivos trazados; si algo falta, el despliegue falla antes de llegar a produccion. La prueba `tests/unit/pdf-fonts.test.ts` cubre lo mismo en local. Si cambias la tipografia de la plantilla, edita `src/lib/pdf/fonts.ts`.

## Que incluye
- **Vendedor:** contadores, filtros por estado, cliente y fecha, alerta de respondidas sin enviar, linea de tiempo por solicitud.
- **Comprador:** bandeja con semaforo, estadisticas con graficas y filtros (fechas, vendedor, cliente, moneda), exportacion a Excel y CSV, reporte de auditoria exportable, clientes, usuarios y configuracion (factores con historial, plazos, zona horaria, festivos).
- **Notificaciones:** campana con contador y conteo en el titulo de la pestana (solo dentro del portal).

## Cron en Vercel
El plan gratuito (Hobby) solo permite cron **una vez al dia**. "Vencida" se calcula al consultar a partir de `due_at`; el cron diario solo genera avisos dentro del portal.

## Leads (solo vendedores)
Migración `0016_leads.sql`. Cada vendedor tiene su propio embudo de prospectos en **Leads**:
- **Lista** con filtros por etapa, búsqueda, seguimientos vencidos o de hoy, y botones de llamar y WhatsApp en el celular.
- **Ficha del lead**: datos del contacto, producto que le interesa, etapa (Nuevo, Contactado, Interesado, Cotizando, Negociación, Ganado, Perdido con motivo), registro rápido de contactos (llamada con resultado, WhatsApp, correo, visita, reunión, muestra, cotización, nota) con próximo seguimiento, e historial completo.
- **Reglas automáticas**: el primer contacto pasa el lead de Nuevo a Contactado; cada contacto actualiza "último contacto"; cada cambio de etapa queda en el historial y en la bitácora de auditoría. Nada se borra: se archiva.
- **Crear solicitud de cotización** desde el lead: lo da de alta como cliente prospecto y abre la solicitud con el cliente ya elegido. **Convertir a cliente** lo marca como ganado (reutiliza el cliente si ya existe con ese nombre).
- **Gráficas**: leads por etapa, contactos por semana (llamadas, mensajes, visitas), nuevos vs. convertidos por mes y origen de los leads. Indicadores de activos, contactos del mes, clientes ganados, conversión y valor en proceso.
- **Seguridad**: cada vendedor ve solo sus leads y los que no tienen dueño. El comprador no los ve.

### Conectar el formulario del sitio web
`POST /api/leads/entrada` con `Authorization: Bearer <LEADS_WEBHOOK_SECRET>` y un JSON (o form-urlencoded) con
`empresa` (obligatorio), `telefono` o `correo` (al menos uno), y opcionales `nombre`, `puesto`, `ciudad`, `industria`, `producto`, `mensaje`, `pagina`, `externo_id` (evita duplicados) y `website` (campo trampa anti-spam: déjalo vacío y oculto).
El lead entra **sin vendedor** con origen "Sitio web", todos los vendedores reciben una notificación y el primero que lo toma se queda con él.
El secreto nunca debe ir en el navegador: el formulario del sitio lo debe enviar desde su propio servidor (por ejemplo una API route del sitio) o desde Zapier/Make.

```bash
curl -X POST https://<portal>/api/leads/entrada \
  -H "Authorization: Bearer $LEADS_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"empresa":"Planta Norte","nombre":"Laura","telefono":"6141234567","producto":"Guantes de nitrilo"}'
```

## Interfaz
- Barra de navegación con la sección activa; en celular, barra inferior fija con las secciones principales y menú "Más".
- Barra de progreso arriba y esqueletos de carga mientras se abre cada página; los botones muestran un indicador mientras guardan.
- Listas como tarjetas en celular y tablas en escritorio.
- **Historial del comprador**: ahora muestra por defecto todas las partidas que ya respondió (antes salía vacío hasta buscar), con contadores de hoy, semana, mes y total, filtros por estado y paginación. La búsqueda por producto o proveedor sigue igual.

## Envío al cliente, recotización y clientes (migración 0017)
- **Registrar el envío al cliente** (por cotización, ya no por partida): en la solicitud, el vendedor elige los precios, revisa el PDF y, en 3 pasos, lo descarga o comparte, abre su correo o WhatsApp con el mensaje listo (adjunta el PDF) y lo **registra como enviado** eligiendo el medio (correo, WhatsApp, en persona, teléfono u otro) y a quién. Se guarda una **copia fija del PDF** con su número (`quote_issues`), los precios enviados (`quote_issue_lines`) y cada envío (`quote_issue_sends`). "Registrar otro envío" agrega un envío del mismo número sin crear otro.
- **Número de cotización:** el folio de la solicitud; `-R2` si el comprador actualizó costos; `-V2`, `-V3` por cada recotización. Ej.: `COT-2026-0040`, `COT-2026-0040-V2`, `COT-2026-0040-R2`.
- **Recotizar:** desde la cotización enviada, con motivo. Permite elegir otro de los 5 precios y cambiar el envío o los datos del PDF; al registrarla nace un número nuevo y la anterior se conserva igual (se puede volver a descargar exacta). "Cancelar recotización" regresa a los precios enviados.
- **Envío al cliente, 4 formas:** *sin envío* (local o recoge), *incluido en el precio* ("envío gratis", repartido por pedido, por unidad o por partida), *cargo aparte* (renglón "Envío / Shipping" en el PDF) y *mixto* (una parte incluida y otra como renglón). La leyenda "Prices include shipping..." solo sale cuando el envío va dentro de los precios.
- **Base general de clientes** (Clientes, para vendedores y comprador): buscador por nombre, RFC, contacto, teléfono o correo; alta y edición con nombre, razón social, RFC (extranjero: `XEXX010101000`), dirección y teléfono o correo. Al crear una solicitud se elige el cliente con buscador o se da de alta ahí mismo; no se puede enviar si al cliente le falta RFC, dirección o contacto. Solo el comprador desactiva clientes.
- **Mis cotizaciones (vendedor):** "Requieren tu atención" (aclaraciones, listas para enviar, recotizaciones abiertas, vigencias vencidas y 5+ días sin respuesta), embudo por etapas con colores (con compras, por enviar, con el cliente, ganadas, cerradas) y lista por cotización con su avance.
- El comprador ve en cada solicitud las cotizaciones enviadas, su número, medio y PDF.
