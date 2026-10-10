import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import type { Db } from "../db/index.js";
import { bandSql } from "../priority.js";

/** Read-only views: dashboard summary, detector track records, users and the audit log. */
export function insightRoutes(db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/dashboard", async (req, res) => {
    const [[totals], byPriority, byCategory, grades, workload] = await Promise.all([
      db.query(
        `SELECT
            COUNT(*) FILTER (WHERE status <> 'closed')::INT                          AS open,
            COUNT(*) FILTER (WHERE status <> 'closed' AND assignee_id IS NULL)::INT   AS unassigned,
            COUNT(*) FILTER (WHERE status = 'in_progress')::INT                       AS "inProgress",
            COUNT(*) FILTER (WHERE status <> 'closed' AND assignee_id = $1)::INT      AS mine,
            COUNT(*) FILTER (WHERE status = 'closed')::INT                            AS closed,
            COUNT(*) FILTER (WHERE status <> 'closed'
                             AND ${bandSql("priority_score")} = 'high')::INT          AS "openHigh"
         FROM incidents`,
        [req.user!.id],
      ),
      db.query(
        `SELECT ${bandSql("priority_score")} AS band, COUNT(*)::INT AS count
         FROM incidents WHERE status <> 'closed' GROUP BY 1`,
      ),
      db.query(
        `SELECT category,
                COUNT(*) FILTER (WHERE status <> 'closed')::INT AS open,
                COUNT(*) FILTER (WHERE status = 'closed')::INT AS closed,
                COUNT(*) FILTER (WHERE grade = 'true_positive')::INT AS "truePositives"
         FROM incidents GROUP BY category ORDER BY open DESC, category LIMIT 8`,
      ),
      db.query(`SELECT grade, COUNT(*)::INT AS count FROM incidents WHERE status = 'closed' GROUP BY grade`),
      db.query(
        `SELECT u.id, u.name, COUNT(i.id)::INT AS open
         FROM users u
         LEFT JOIN incidents i ON i.assignee_id = u.id AND i.status <> 'closed'
         WHERE u.role <> 'viewer'
         GROUP BY u.id, u.name ORDER BY open DESC, u.name`,
      ),
    ]);
    res.json({ totals, byPriority, byCategory, grades, workload });
  });

  // Track record of each detector: how much work it creates and how often it is right.
  router.get("/detectors", async (_req, res) => {
    const rows = await db.query(
      `SELECT d.id, d.name, d.category,
              COUNT(i.id)::INT                                                  AS incidents,
              COUNT(i.id) FILTER (WHERE i.status <> 'closed')::INT              AS open,
              COUNT(i.id) FILTER (WHERE i.status = 'closed')::INT               AS graded,
              COUNT(i.id) FILTER (WHERE i.grade = 'true_positive')::INT         AS "truePositives",
              COUNT(i.id) FILTER (WHERE i.grade = 'benign_positive')::INT       AS "benignPositives",
              COUNT(i.id) FILTER (WHERE i.grade = 'false_positive')::INT        AS "falsePositives"
       FROM detectors d
       JOIN incidents i ON i.detector_id = d.id
       GROUP BY d.id, d.name, d.category
       ORDER BY incidents DESC, d.id
       LIMIT 100`,
    );
    res.json(rows);
  });

  router.get("/users", async (_req, res) => {
    res.json(await db.query("SELECT id, name, role FROM users ORDER BY name"));
  });

  const auditQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
  });

  // The audit log is restricted to admins.
  router.get("/audit", requireRole("admin"), async (req, res) => {
    const q = auditQuery.parse(req.query);
    const [count] = await db.query<{ total: number }>(
      "SELECT COUNT(*)::INT AS total FROM incident_events WHERE type <> 'created'",
    );
    const items = await db.query(
      `SELECT ev.id, ev.type, ev.detail, ev.created_at AS "createdAt",
              u.name AS "actorName", i.id AS "incidentId", i.external_ref AS "externalRef"
       FROM incident_events ev
       JOIN incidents i ON i.id = ev.incident_id
       LEFT JOIN users u ON u.id = ev.actor_id
       WHERE ev.type <> 'created'
       ORDER BY ev.created_at DESC, ev.id DESC
       LIMIT $1 OFFSET $2`,
      [q.pageSize, (q.page - 1) * q.pageSize],
    );
    res.json({ items, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize });
  });

  return router;
}
