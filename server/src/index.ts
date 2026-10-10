import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { connect, migrate } from "./db/index.js";
import { seedIfEmpty } from "./seed/load.js";

// `--port` wins over PORT so the dev script can pin the API to 4000 even when a
// tool exports PORT for the front-end dev server.
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : (process.env.PORT ?? 4000));
const here = dirname(fileURLToPath(import.meta.url));

const db = await connect();
const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
await seedIfEmpty(db);

const app = createApp(db, { staticDir: process.env.STATIC_DIR ?? join(here, "..", "..", "web", "dist") });
const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(process.env.DATABASE_URL ? "Database: PostgreSQL server" : "Database: embedded PostgreSQL (PGlite)");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  });
}
