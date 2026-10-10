import { hashPassword } from "../auth.js";
import type { Db, Queryable } from "../db/index.js";
import { rescoreAll } from "../priority.js";
import { DEMO_USERS, demoPassword } from "./demo-users.js";
import { syntheticIncidents } from "./synthetic.js";

export type Grade = "true_positive" | "benign_positive" | "false_positive";

/** The shape both seed sources (synthetic and GUIDE) produce. */
export interface SeedIncident {
  externalRef: string;
  category: string;
  detectorId: number;
  /** null leaves the incident open in the queue; a grade loads it as already closed. */
  grade: Grade | null;
  alerts: {
    detectorId: number;
    category: string;
    mitreTechniques: string | null;
    occurredAt: Date;
    evidence: { entityType: string; role: string; verdict: string | null }[];
  }[];
}

const CHUNK = 1000;

async function insertJson(db: Queryable, sql: string, rows: unknown[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.query(sql, [JSON.stringify(rows.slice(i, i + CHUNK))]);
  }
}

export async function resetData(db: Db): Promise<void> {
  await db.query("TRUNCATE incident_events, evidence, alerts, incidents, detectors, users RESTART IDENTITY CASCADE");
}

export async function seedUsers(db: Db): Promise<void> {
  const hash = await hashPassword(demoPassword());
  for (const user of DEMO_USERS) {
    await db.query(
      "INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING",
      [user.email, user.name, user.role, hash],
    );
  }
}

/** Human-readable label for a category such as "InitialAccess". */
export function categoryLabel(category: string): string {
  return category.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bAnd\b/g, "and");
}

/**
 * Loads incidents with their alerts and evidence. Graded incidents are loaded as
 * history (closed by one of the analysts); ungraded ones land in the queue as new.
 * Ids are assigned here so child rows can reference parents without a round trip.
 */
export async function loadIncidents(db: Db, incidents: SeedIncident[]): Promise<void> {
  const analysts = await db.query<{ id: number }>("SELECT id FROM users WHERE role <> 'viewer' ORDER BY id");
  if (analysts.length === 0) throw new Error("Seed users before incidents.");

  const detectors = new Map<number, string>();
  const incidentRows: unknown[] = [];
  const alertRows: unknown[] = [];
  const evidenceRows: unknown[] = [];
  let alertId = 0;

  incidents.forEach((incident, index) => {
    const id = index + 1;
    const times = incident.alerts.map((a) => a.occurredAt.getTime());
    const firstSeen = new Date(Math.min(...times));
    const lastSeen = new Date(Math.max(...times));
    detectors.set(incident.detectorId, incident.category);
    let evidenceCount = 0;

    for (const alert of incident.alerts) {
      alertId += 1;
      if (!detectors.has(alert.detectorId)) detectors.set(alert.detectorId, alert.category);
      alertRows.push({
        id: alertId,
        incident_id: id,
        detector_id: alert.detectorId,
        category: alert.category,
        mitre_techniques: alert.mitreTechniques,
        occurred_at: alert.occurredAt.toISOString(),
      });
      for (const e of alert.evidence) {
        evidenceRows.push({ alert_id: alertId, entity_type: e.entityType, role: e.role, verdict: e.verdict });
        evidenceCount += 1;
      }
    }

    const closed = incident.grade !== null;
    // History is closed a few hours after the last alert, by a rotating analyst.
    const closedAt = closed ? new Date(lastSeen.getTime() + (1 + (id % 9)) * 3_600_000) : null;
    incidentRows.push({
      id,
      external_ref: incident.externalRef,
      title: `${categoryLabel(incident.category)} alert from detector D-${String(incident.detectorId).padStart(4, "0")}`,
      category: incident.category,
      detector_id: incident.detectorId,
      status: closed ? "closed" : "new",
      grade: incident.grade,
      assignee_id: closed ? analysts[id % analysts.length]!.id : null,
      alert_count: incident.alerts.length,
      evidence_count: evidenceCount,
      first_seen_at: firstSeen.toISOString(),
      closed_at: closedAt?.toISOString() ?? null,
    });
  });

  await db.transaction(async (tx) => {
    await insertJson(
      tx,
      `INSERT INTO detectors (id, name, category)
       SELECT id, name, category FROM jsonb_to_recordset($1::jsonb) AS x(id INT, name TEXT, category TEXT)`,
      [...detectors].map(([id, category]) => ({ id, name: `D-${String(id).padStart(4, "0")}`, category })),
    );
    await insertJson(
      tx,
      `INSERT INTO incidents (id, external_ref, title, category, detector_id, status, grade, assignee_id,
                              alert_count, evidence_count, first_seen_at, created_at, updated_at, closed_at)
       SELECT id, external_ref, title, category, detector_id, status, grade, assignee_id,
              alert_count, evidence_count, first_seen_at, first_seen_at, COALESCE(closed_at, first_seen_at), closed_at
       FROM jsonb_to_recordset($1::jsonb) AS x(
            id INT, external_ref TEXT, title TEXT, category TEXT, detector_id INT, status TEXT, grade TEXT,
            assignee_id INT, alert_count INT, evidence_count INT, first_seen_at TIMESTAMPTZ, closed_at TIMESTAMPTZ)`,
      incidentRows,
    );
    await insertJson(
      tx,
      `INSERT INTO alerts (id, incident_id, detector_id, category, mitre_techniques, occurred_at)
       SELECT id, incident_id, detector_id, category, mitre_techniques, occurred_at
       FROM jsonb_to_recordset($1::jsonb) AS x(
            id INT, incident_id INT, detector_id INT, category TEXT, mitre_techniques TEXT, occurred_at TIMESTAMPTZ)`,
      alertRows,
    );
    await insertJson(
      tx,
      `INSERT INTO evidence (alert_id, entity_type, role, verdict)
       SELECT alert_id, entity_type, role, verdict
       FROM jsonb_to_recordset($1::jsonb) AS x(alert_id INT, entity_type TEXT, role TEXT, verdict TEXT)`,
      evidenceRows,
    );
    // Explicit ids were inserted, so move the sequences past them.
    await tx.query("SELECT setval('incidents_id_seq', (SELECT COALESCE(MAX(id), 1) FROM incidents))");
    await tx.query("SELECT setval('alerts_id_seq', (SELECT COALESCE(MAX(id), 1) FROM alerts))");

    // Audit trail for the loaded history.
    await tx.query(
      `INSERT INTO incident_events (incident_id, type, detail, created_at)
       SELECT id, 'created', jsonb_build_object('source', 'import'), first_seen_at FROM incidents`,
    );
    await tx.query(
      `INSERT INTO incident_events (incident_id, actor_id, type, detail, created_at)
       SELECT id, assignee_id, 'status_changed',
              jsonb_build_object('from', 'in_progress', 'to', 'closed', 'grade', grade), closed_at
       FROM incidents WHERE status = 'closed'`,
    );
    await rescoreAll(tx);
  });
}

/** First start with an empty database: create the demo users and synthetic incidents. */
export async function seedIfEmpty(db: Db): Promise<void> {
  const [row] = await db.query<{ n: number }>("SELECT COUNT(*)::INT AS n FROM users");
  if ((row?.n ?? 0) > 0) return;
  await seedUsers(db);
  await loadIncidents(db, syntheticIncidents());
  console.log("Seeded demo users and synthetic incidents.");
}
