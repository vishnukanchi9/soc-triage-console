import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import type { Db, Queryable } from "../db/index.js";
import { HttpError } from "../errors.js";
import { bandSql, rescoreDetector } from "../priority.js";

const STATUSES = ["new", "in_progress", "closed"] as const;
const GRADES = ["true_positive", "benign_positive", "false_positive"] as const;
const BANDS = ["high", "medium", "low"] as const;

const listQuery = z.object({
  // "open" means new or in progress
  status: z.enum([...STATUSES, "open"]).optional(),
  priority: z.enum(BANDS).optional(),
  category: z.string().max(60).optional(),
  // "me", "unassigned", or a user id
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.coerce.number().int().positive()]).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["priority", "newest", "oldest"]).default("priority"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const assignBody = z.object({
  assigneeId: z.number().int().positive().nullable(),
  version: z.number().int().positive(),
});

const statusBody = z
  .object({
    status: z.enum(STATUSES),
    grade: z.enum(GRADES).optional(),
    version: z.number().int().positive(),
  })
  .refine((b) => (b.status === "closed") === (b.grade !== undefined), {
    message: "A grade is required when closing an incident, and only then.",
    path: ["grade"],
  });

const commentBody = z.object({ body: z.string().trim().min(1).max(2000) });

const ORDER_BY = {
  priority: "i.priority_score DESC, i.first_seen_at DESC, i.id DESC",
  newest: "i.first_seen_at DESC, i.id DESC",
  oldest: "i.first_seen_at ASC, i.id ASC",
} as const;

const INCIDENT_COLUMNS = `
  i.id, i.external_ref AS "externalRef", i.title, i.category, i.status, i.grade,
  i.detector_id AS "detectorId", d.name AS "detectorName",
  i.assignee_id AS "assigneeId", u.name AS "assigneeName",
  i.priority_score AS "priorityScore", ${bandSql("i.priority_score")} AS "priorityBand",
  i.alert_count AS "alertCount", i.evidence_count AS "evidenceCount",
  i.first_seen_at AS "firstSeenAt", i.updated_at AS "updatedAt", i.closed_at AS "closedAt",
  i.version`;

interface IncidentRow {
  id: number;
  status: (typeof STATUSES)[number];
  assigneeId: number | null;
  detectorId: number;
  version: number;
}

/** Locks the incident row and checks the caller read the latest version. */
async function lockForUpdate(tx: Queryable, id: number, version: number): Promise<IncidentRow> {
  const [row] = await tx.query<IncidentRow>(
    `SELECT id, status, assignee_id AS "assigneeId", detector_id AS "detectorId", version
     FROM incidents WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!row) throw new HttpError(404, "not_found", "Incident not found.");
  if (row.version !== version) {
    throw new HttpError(409, "version_conflict", "This incident was changed by someone else. Reload and try again.");
  }
  return row;
}

async function recordEvent(
  tx: Queryable,
  incidentId: number,
  actorId: number,
  type: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    "INSERT INTO incident_events (incident_id, actor_id, type, detail) VALUES ($1, $2, $3, $4::jsonb)",
    [incidentId, actorId, type, JSON.stringify(detail)],
  );
}

export function incidentRoutes(db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  // ---- queue ---------------------------------------------------------------
  router.get("/", async (req, res) => {
    const q = listQuery.parse(req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };

    if (q.status === "open") where.push("i.status <> 'closed'");
    else if (q.status) add("i.status = ?", q.status);
    if (q.category) add("i.category = ?", q.category);
    if (q.priority) add(`${bandSql("i.priority_score")} = ?`, q.priority);
    if (q.assignee === "unassigned") where.push("i.assignee_id IS NULL");
    else if (q.assignee === "me") add("i.assignee_id = ?", req.user!.id);
    else if (q.assignee !== undefined) add("i.assignee_id = ?", q.assignee);
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`);
      where.push(`(i.title ILIKE $${params.length} OR i.external_ref ILIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const [count] = await db.query<{ total: number }>(
      `SELECT COUNT(*)::INT AS total FROM incidents i ${whereSql}`,
      params,
    );
    const items = await db.query(
      `SELECT ${INCIDENT_COLUMNS}
       FROM incidents i
       JOIN detectors d ON d.id = i.detector_id
       LEFT JOIN users u ON u.id = i.assignee_id
       ${whereSql}
       ORDER BY ${ORDER_BY[q.sort]}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.pageSize, (q.page - 1) * q.pageSize],
    );
    res.json({ items, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize });
  });

  router.get("/categories", async (_req, res) => {
    const rows = await db.query<{ category: string }>("SELECT DISTINCT category FROM incidents ORDER BY category");
    res.json(rows.map((r) => r.category));
  });

  // ---- detail --------------------------------------------------------------
  router.get("/:id", async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [incident] = await db.query(
      `SELECT ${INCIDENT_COLUMNS}
       FROM incidents i
       JOIN detectors d ON d.id = i.detector_id
       LEFT JOIN users u ON u.id = i.assignee_id
       WHERE i.id = $1`,
      [id],
    );
    if (!incident) throw new HttpError(404, "not_found", "Incident not found.");

    const [alerts, evidence, events, detector] = await Promise.all([
      db.query(
        `SELECT a.id, a.category, a.mitre_techniques AS "mitreTechniques", a.occurred_at AS "occurredAt",
                a.detector_id AS "detectorId", d.name AS "detectorName"
         FROM alerts a JOIN detectors d ON d.id = a.detector_id
         WHERE a.incident_id = $1 ORDER BY a.occurred_at, a.id`,
        [id],
      ),
      db.query(
        `SELECT e.entity_type AS "entityType", e.role, e.verdict, COUNT(*)::INT AS count
         FROM evidence e JOIN alerts a ON a.id = e.alert_id
         WHERE a.incident_id = $1
         GROUP BY e.entity_type, e.role, e.verdict
         ORDER BY count DESC, e.entity_type`,
        [id],
      ),
      db.query(
        `SELECT ev.id, ev.type, ev.detail, ev.created_at AS "createdAt", u.name AS "actorName"
         FROM incident_events ev LEFT JOIN users u ON u.id = ev.actor_id
         WHERE ev.incident_id = $1 ORDER BY ev.created_at, ev.id`,
        [id],
      ),
      // the track record behind the priority score
      db.query(
        `SELECT COUNT(*)::INT AS graded,
                COALESCE(SUM((grade = 'true_positive')::INT), 0)::INT AS "truePositives"
         FROM incidents
         WHERE status = 'closed'
           AND detector_id = (SELECT detector_id FROM incidents WHERE id = $1)`,
        [id],
      ),
    ]);
    res.json({ incident, alerts, evidence, events, detectorHistory: detector[0] });
  });

  // ---- assign --------------------------------------------------------------
  // Analysts may take an incident or release their own; admins may assign anyone.
  router.post("/:id/assign", requireRole("analyst", "admin"), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const actor = req.user!;

    await db.transaction(async (tx) => {
      const current = await lockForUpdate(tx, id, body.version);
      if (current.status === "closed") {
        throw new HttpError(409, "incident_closed", "A closed incident cannot be reassigned.");
      }
      if (actor.role === "analyst") {
        const takingForSelf = body.assigneeId === actor.id;
        const releasingOwn = body.assigneeId === null && current.assigneeId === actor.id;
        if (!takingForSelf && !releasingOwn) {
          throw new HttpError(403, "forbidden", "Analysts can only take an incident or release their own.");
        }
      }
      let assigneeName: string | null = null;
      if (body.assigneeId !== null) {
        const [assignee] = await tx.query<{ name: string; role: string }>(
          "SELECT name, role FROM users WHERE id = $1",
          [body.assigneeId],
        );
        if (!assignee) throw new HttpError(400, "invalid_assignee", "That user does not exist.");
        if (assignee.role === "viewer") {
          throw new HttpError(400, "invalid_assignee", "Viewers cannot be assigned incidents.");
        }
        assigneeName = assignee.name;
      }
      await tx.query(
        "UPDATE incidents SET assignee_id = $1, version = version + 1, updated_at = now() WHERE id = $2",
        [body.assigneeId, id],
      );
      await recordEvent(tx, id, actor.id, body.assigneeId === null ? "unassigned" : "assigned", {
        from: current.assigneeId,
        to: body.assigneeId,
        toName: assigneeName,
      });
    });
    res.json({ ok: true });
  });

  // ---- status --------------------------------------------------------------
  // new -> in_progress -> closed (with a grade); closed -> in_progress reopens.
  router.post("/:id/status", requireRole("analyst", "admin"), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = statusBody.parse(req.body);
    const actor = req.user!;

    await db.transaction(async (tx) => {
      const current = await lockForUpdate(tx, id, body.version);
      if (current.status === body.status) {
        throw new HttpError(409, "no_change", `The incident is already ${body.status.replace("_", " ")}.`);
      }
      if (body.status === "new") {
        throw new HttpError(409, "invalid_transition", "An incident cannot be moved back to new.");
      }
      if (actor.role === "analyst" && current.assigneeId !== actor.id) {
        throw new HttpError(403, "forbidden", "Take the incident before changing its status.");
      }

      if (body.status === "closed") {
        await tx.query(
          `UPDATE incidents
           SET status = 'closed', grade = $1, closed_at = now(), version = version + 1, updated_at = now()
           WHERE id = $2`,
          [body.grade, id],
        );
      } else {
        await tx.query(
          `UPDATE incidents
           SET status = $1, grade = NULL, closed_at = NULL, version = version + 1, updated_at = now()
           WHERE id = $2`,
          [body.status, id],
        );
      }
      await recordEvent(tx, id, actor.id, "status_changed", {
        from: current.status,
        to: body.status,
        grade: body.grade ?? null,
      });
      // A new grade (or a withdrawn one) changes the detector's track record.
      if (body.status === "closed" || current.status === "closed") {
        await rescoreDetector(tx, current.detectorId);
      }
    });
    res.json({ ok: true });
  });

  // ---- comments ------------------------------------------------------------
  router.post("/:id/comments", requireRole("analyst", "admin"), async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { body } = commentBody.parse(req.body);
    await db.transaction(async (tx) => {
      const [exists] = await tx.query("SELECT 1 FROM incidents WHERE id = $1", [id]);
      if (!exists) throw new HttpError(404, "not_found", "Incident not found.");
      await recordEvent(tx, id, req.user!.id, "comment", { body });
    });
    res.status(201).json({ ok: true });
  });

  return router;
}
