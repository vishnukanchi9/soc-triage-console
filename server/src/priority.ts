import type { Queryable } from "./db/index.js";

/**
 * Priority scoring.
 *
 * An incident's score is the share of its detector's past incidents that analysts
 * graded as true positives, i.e. how often that detector has been right. The rate
 * is smoothed towards the overall rate so a detector with three graded incidents
 * is not trusted like one with three thousand:
 *
 *     score = (true_positives + K * overall_rate) / (graded + K)
 *
 * The score is recalculated for a detector's open incidents every time one of its
 * incidents is closed, so the queue re-ranks itself as analysts work.
 */
export const SMOOTHING_K = 20;

export type PriorityBand = "high" | "medium" | "low";

export function bandFor(score: number): PriorityBand {
  if (score >= 0.4) return "high";
  if (score >= 0.15) return "medium";
  return "low";
}

/** SQL fragment mapping a score column to its band; keep in step with bandFor(). */
export function bandSql(column: string): string {
  return `CASE WHEN ${column} >= 0.4 THEN 'high' WHEN ${column} >= 0.15 THEN 'medium' ELSE 'low' END`;
}

const SCORE_SQL = `
  WITH overall AS (
      SELECT COALESCE(AVG((grade = 'true_positive')::INT), 0.2) AS rate
      FROM incidents
      WHERE status = 'closed'
  ),
  detector_history AS (
      SELECT detector_id,
             COUNT(*)                                AS graded,
             SUM((grade = 'true_positive')::INT)     AS true_positives
      FROM incidents
      WHERE status = 'closed'
      GROUP BY detector_id
  )
  UPDATE incidents i
  SET priority_score = (
      (COALESCE(h.true_positives, 0) + ${SMOOTHING_K} * o.rate) / (COALESCE(h.graded, 0) + ${SMOOTHING_K})
  )
  FROM overall o, detectors d
  LEFT JOIN detector_history h ON h.detector_id = d.id
  WHERE i.detector_id = d.id
    AND i.status <> 'closed'`;

/** Re-scores every open incident. Used after seeding. */
export async function rescoreAll(db: Queryable): Promise<void> {
  await db.query(SCORE_SQL);
}

/** Re-scores the open incidents of one detector. Used when an incident is closed. */
export async function rescoreDetector(db: Queryable, detectorId: number): Promise<void> {
  await db.query(`${SCORE_SQL} AND i.detector_id = $1`, [detectorId]);
}
