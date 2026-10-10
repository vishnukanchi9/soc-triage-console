import request from "supertest";
import { createApp } from "../src/app.js";
import { createEmbeddedDb, migrate, type Db } from "../src/db/index.js";
import { demoPassword } from "../src/seed/demo-users.js";
import { loadIncidents, seedUsers, type Grade, type SeedIncident } from "../src/seed/load.js";

function incident(ref: string, detectorId: number, category: string, grade: Grade | null, hour: number): SeedIncident {
  return {
    externalRef: ref,
    category,
    detectorId,
    grade,
    alerts: [
      {
        detectorId,
        category,
        mitreTechniques: null,
        occurredAt: new Date(Date.UTC(2024, 5, 3, hour)),
        evidence: [
          { entityType: "Ip", role: "Related", verdict: null },
          { entityType: "User", role: "Impacted", verdict: "Suspicious" },
        ],
      },
    ],
  };
}

/**
 * A small, known dataset:
 *   detector 1 (InitialAccess): 10 graded, 8 true positives  -> a reliable detector
 *   detector 2 (Exfiltration):  10 graded, 0 true positives  -> a noisy detector
 *   3 open incidents on each
 */
export function fixtureIncidents(): SeedIncident[] {
  const out: SeedIncident[] = [];
  for (let i = 0; i < 10; i++) {
    out.push(incident(`D1-CLOSED-${i}`, 1, "InitialAccess", i < 8 ? "true_positive" : "false_positive", i));
    out.push(incident(`D2-CLOSED-${i}`, 2, "Exfiltration", i < 5 ? "benign_positive" : "false_positive", i));
  }
  for (let i = 0; i < 3; i++) {
    out.push(incident(`D1-OPEN-${i}`, 1, "InitialAccess", null, 12 + i));
    out.push(incident(`D2-OPEN-${i}`, 2, "Exfiltration", null, 12 + i));
  }
  return out;
}

export interface TestContext {
  db: Db;
  app: ReturnType<typeof createApp>;
  /** A signed-in agent for one of the demo accounts. */
  as(role: "admin" | "analyst" | "analyst2" | "viewer"): Promise<ReturnType<typeof request.agent>>;
  /** Id and current version of an incident, by external reference. */
  find(ref: string): Promise<{ id: number; version: number; priorityScore: number; status: string }>;
  userId(email: string): Promise<number>;
}

export async function createTestContext(): Promise<TestContext> {
  const db = await createEmbeddedDb();
  await migrate(db);
  await seedUsers(db);
  await loadIncidents(db, fixtureIncidents());
  const app = createApp(db);

  return {
    db,
    app,
    async as(role) {
      const agent = request.agent(app);
      const res = await agent.post("/api/auth/login").send({ email: `${role}@soc.test`, password: demoPassword() });
      if (res.status !== 200) throw new Error(`login failed for ${role}: ${res.status}`);
      return agent;
    },
    async find(ref) {
      const [row] = await db.query<{ id: number; version: number; priorityScore: number; status: string }>(
        `SELECT id, version, priority_score AS "priorityScore", status FROM incidents WHERE external_ref = $1`,
        [ref],
      );
      if (!row) throw new Error(`no incident ${ref}`);
      return row;
    },
    async userId(email) {
      const [row] = await db.query<{ id: number }>("SELECT id FROM users WHERE email = $1", [email]);
      return row!.id;
    },
  };
}
