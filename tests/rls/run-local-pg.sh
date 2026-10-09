#!/usr/bin/env bash
# Levanta un Postgres temporal con un shim de Supabase y aplica las migraciones.
# Uso: tests/rls/run-local-pg.sh  -> imprime DATABASE_URL en la ultima linea.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN=/usr/lib/postgresql/16/bin
DIR=${PGTEST_DIR:-/tmp/esc-pgtest}
PORT=${PGTEST_PORT:-54329}
if [ ! -d "$DIR/data" ]; then
  mkdir -p "$DIR" && chown -R postgres "$DIR"
  su postgres -c "$BIN/initdb -D $DIR/data -A trust >/dev/null"
fi
if ! su postgres -c "$BIN/pg_ctl -D $DIR/data status" >/dev/null 2>&1; then
  su postgres -c "$BIN/pg_ctl -D $DIR/data -o '-p $PORT -k $DIR' -l $DIR/log -w start" >/dev/null
fi
PSQL="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "drop database if exists esc_test" -c "create database esc_test" >/dev/null
$PSQL -d esc_test -f "$ROOT/tests/rls/supabase-shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d esc_test -f "$f" >/dev/null; done
echo "postgres://postgres@localhost:$PORT/esc_test?host=$DIR"
