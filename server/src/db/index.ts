import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

/**
 * The small database surface the application uses. Two implementations sit behind
 * it: node-postgres for a real PostgreSQL server, and PGlite (PostgreSQL compiled
 * to WebAssembly) for zero-setup local development and for tests. Both speak the
 * same SQL, so there is one set of queries.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// node-postgres returns BIGINT and NUMERIC as strings; COUNT(*) is a BIGINT.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pool.query(text, params)).rows as T[];
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query<R>(text: string, params: unknown[] = []) {
            return (await client.query(text, params)).rows as R[];
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** `dataDir` undefined keeps the database in memory (used by the tests). */
export async function createEmbeddedDb(dataDir?: string): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const lite = new PGlite(dataDir);
  await lite.waitReady;
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await lite.query<T>(text, params)).rows;
    },
    transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return lite.transaction((tx) =>
        fn({
          async query<R>(text: string, params: unknown[] = []) {
            return (await tx.query<R>(text, params)).rows;
          },
        }),
      ) as Promise<T>;
    },
    close: () => lite.close(),
  };
}

/** DATABASE_URL selects a PostgreSQL server; otherwise an embedded database on disk. */
export async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) return createPgDb(url);
  const here = dirname(fileURLToPath(import.meta.url));
  return createEmbeddedDb(process.env.EMBEDDED_DB_DIR ?? join(here, "..", "..", ".data", "pg"));
}

/** Applies any migration in db/migrations that has not been applied yet, in name order. */
export async function migrate(db: Db): Promise<string[]> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
  );
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const statements = splitStatements(readFileSync(join(dir, file), "utf8"));
    await db.transaction(async (tx) => {
      for (const statement of statements) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

/** Splits a migration file into statements. Migrations here contain no semicolons inside strings. */
function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
