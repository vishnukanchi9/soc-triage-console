import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { Grade, SeedIncident } from "./load.js";

/**
 * Imports one organisation's incidents from Microsoft's GUIDE dataset
 * (GUIDE_Train.csv, see the README for the download). The file is about 2.4 GB,
 * so it is streamed line by line and only the chosen organisation is kept.
 *
 * GUIDE grades every incident. To give the console a live queue, the most recent
 * `openShare` of incidents are loaded without their grade, as new work; the rest
 * are loaded as graded history, which is what the priority score learns from.
 */

const GRADES: Record<string, Grade> = {
  TruePositive: "true_positive",
  BenignPositive: "benign_positive",
  FalsePositive: "false_positive",
};

/** Splits one CSV line, honouring double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out;
}

export async function guideIncidents(
  csvPath: string,
  options: { orgId?: string; openShare?: number } = {},
): Promise<SeedIncident[]> {
  const orgId = options.orgId ?? "36";
  const openShare = options.openShare ?? 0.15;

  const lines = createInterface({ input: createReadStream(csvPath, "utf8"), crlfDelay: Infinity });
  let col: Record<string, number> | null = null;
  const incidents = new Map<string, { grade: Grade | null; alerts: Map<string, SeedIncident["alerts"][number]> }>();

  for await (const line of lines) {
    if (!col) {
      col = Object.fromEntries(parseCsvLine(line).map((name, i) => [name, i]));
      continue;
    }
    // Cheap pre-filter before the full parse: OrgId is the second column.
    const firstComma = line.indexOf(",");
    if (!line.startsWith(`${orgId},`, firstComma + 1)) continue;

    const f = parseCsvLine(line);
    const get = (name: string) => f[col![name]!] ?? "";
    const occurredAt = new Date(get("Timestamp"));
    if (Number.isNaN(occurredAt.getTime())) continue;

    let incident = incidents.get(get("IncidentId"));
    if (!incident) {
      incident = { grade: GRADES[get("IncidentGrade")] ?? null, alerts: new Map() };
      incidents.set(get("IncidentId"), incident);
    }
    let alert = incident.alerts.get(get("AlertId"));
    if (!alert) {
      alert = {
        detectorId: Number(get("DetectorId")),
        category: get("Category"),
        mitreTechniques: get("MitreTechniques") || null,
        occurredAt,
        evidence: [],
      };
      incident.alerts.set(get("AlertId"), alert);
    }
    if (occurredAt < alert.occurredAt) alert.occurredAt = occurredAt;
    alert.evidence.push({
      entityType: get("EntityType"),
      role: get("EvidenceRole"),
      verdict: get("LastVerdict") || null,
    });
  }

  const result: (SeedIncident & { firstAt: number })[] = [];
  for (const [incidentId, incident] of incidents) {
    if (incident.grade === null) continue; // GUIDE leaves a few incidents ungraded
    const alerts = [...incident.alerts.values()].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const first = alerts[0]!;
    result.push({
      externalRef: `GUIDE-${orgId}-${incidentId}`,
      category: first.category,
      detectorId: first.detectorId,
      grade: incident.grade,
      alerts,
      firstAt: first.occurredAt.getTime(),
    });
  }

  result.sort((a, b) => a.firstAt - b.firstAt);
  const openFromIndex = Math.floor(result.length * (1 - openShare));
  return result.map(({ firstAt: _firstAt, ...incident }, index) => ({
    ...incident,
    grade: index >= openFromIndex ? null : incident.grade,
  }));
}
