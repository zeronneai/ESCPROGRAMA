# Actualizaciones de base de datos

`supabase/instalar-todo.sql` esta **congelado**: es lo que ya se instalo en Supabase. No se vuelve a editar ni a pegar.

Cualquier cambio posterior de base de datos se entrega asi:

1. Una migracion nueva y numerada en `supabase/migrations/` (`0006_...sql`, `0007_...sql`, ...).
2. El mismo cambio, solo ese, en este directorio con el mismo nombre (`supabase/actualizaciones/0006_...sql`), para pegarlo en el SQL Editor sin reinstalar.

Se pegan **en orden numerico**, una sola vez cada uno. Una prueba automatica (`tests/unit/migrations.test.ts`) verifica que las migraciones ya instaladas no cambien y que cada migracion nueva tenga su archivo aqui.

## Pendientes de pegar

Hasta la fase 3 no hay ninguno: la fase 3 no cambio la base de datos.
