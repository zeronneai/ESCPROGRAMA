import pg from "pg";

export const DATABASE_URL = process.env.DATABASE_URL;

export const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 4 }) : (null as never);

export type Actor = { id: string; role: "authenticated" | "service_role" | "anon" } | "postgres";

/** Ejecuta `fn` en una transaccion simulando una sesion de la API de Supabase. */
export async function as<T>(
  actor: Actor,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
  { commit = true }: { commit?: boolean } = {},
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (actor !== "postgres") {
      await client.query(`set local role ${actor.role}`);
      await client.query(
        "select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)",
        [actor.id, actor.role],
      );
    }
    const out = await fn((sql, params) => client.query(sql, params));
    await client.query(commit ? "commit" : "rollback");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Espera que la operacion falle y devuelve el mensaje de error. */
export async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("Se esperaba un error, pero la operacion tuvo exito");
}
