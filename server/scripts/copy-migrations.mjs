// tsc does not copy .sql files; the migration runner reads them at start-up.
import { cpSync } from "node:fs";
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
