/**
 * Resets the database and loads demo data.
 *
 *   npm run seed                              synthetic incidents (no downloads needed)
 *   npm run seed:guide -- <GUIDE_Train.csv>   one organisation from Microsoft's GUIDE dataset
 *   npm run seed:guide -- <csv> --org 249     a different organisation
 */
import { connect, migrate } from "../db/index.js";
import { guideIncidents } from "./guide.js";
import { loadIncidents, resetData, seedUsers } from "./load.js";
import { syntheticIncidents } from "./synthetic.js";

const args = process.argv.slice(2);
const useGuide = args.includes("--guide");
const orgIndex = args.indexOf("--org");
const orgId = orgIndex >= 0 ? args[orgIndex + 1] : undefined;
const csvPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--org");

if (useGuide && !csvPath) {
  console.error("Usage: npm run seed:guide -- <path to GUIDE_Train.csv> [--org <id>]");
  process.exit(1);
}

const db = await connect();
await migrate(db);

console.log(useGuide ? `Reading ${csvPath} ...` : "Generating synthetic incidents ...");
const incidents = useGuide ? await guideIncidents(csvPath!, { orgId }) : syntheticIncidents();

await resetData(db);
await seedUsers(db);
await loadIncidents(db, incidents);

const [summary] = await db.query(
  `SELECT COUNT(*)::INT AS incidents,
          COUNT(*) FILTER (WHERE status <> 'closed')::INT AS open,
          (SELECT COUNT(*)::INT FROM alerts) AS alerts,
          (SELECT COUNT(*)::INT FROM evidence) AS evidence,
          (SELECT COUNT(*)::INT FROM detectors) AS detectors
   FROM incidents`,
);
console.log("Loaded:", summary);
await db.close();
