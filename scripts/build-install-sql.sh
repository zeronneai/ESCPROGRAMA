#!/usr/bin/env bash
# Regenera supabase/instalar-todo.sql juntando las migraciones en orden.
# Solo para regenerar desde cero:  bash scripts/build-install-sql.sh --force
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/supabase/instalar-todo.sql"
# instalar-todo.sql esta CONGELADO (ya se instalo en Supabase). Los cambios nuevos van en
# supabase/migrations/NNNN_*.sql y se copian a supabase/actualizaciones/NNNN_*.sql.
if [ -e "$OUT" ] && [ "${1:-}" != "--force" ]; then
  echo "instalar-todo.sql ya existe y esta congelado. Usa --force solo para una instalacion nueva desde cero." >&2
  exit 1
fi
{
  cat <<'HEADER'
-- =============================================================================
-- ESC Portal de Cotizaciones: instalacion completa de la base de datos
-- =============================================================================
-- COMO USAR (una sola vez, en un proyecto de Supabase NUEVO):
--   1. Supabase > SQL Editor > New query.
--   2. Pega TODO este archivo y presiona Run.
--   3. Debe terminar con "Success. No rows returned".
-- No lo ejecutes dos veces: si falla a la mitad, borra los objetos creados o usa
-- un proyecto nuevo. Este archivo se genera de supabase/migrations/*.sql
-- (bash scripts/build-install-sql.sh); no lo edites a mano.
-- Despues: crea tu usuario en Authentication > Users > Add user y corre
-- supabase/primer-comprador.sql.
-- =============================================================================

HEADER
  for f in "$ROOT"/supabase/migrations/*.sql; do
    printf '\n-- -----------------------------------------------------------------------------\n'
    printf -- '-- %s\n' "$(basename "$f")"
    printf -- '-- -----------------------------------------------------------------------------\n\n'
    cat "$f"
    printf '\n'
  done
} > "$OUT"
echo "Generado $OUT ($(wc -l < "$OUT") lineas)"
