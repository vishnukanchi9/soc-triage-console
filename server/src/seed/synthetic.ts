import type { Grade, SeedIncident } from "./load.js";

/**
 * Synthetic incidents so the app runs with no downloads. The shape follows what
 * the real GUIDE data looks like: a few detectors raise most incidents, most
 * incidents have a single alert, and detectors differ widely in how often they
 * are right. Generation is seeded, so every run produces the same data.
 */

/** mulberry32: a small deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES: { name: string; weight: number; mitre: string[] }[] = [
  { name: "InitialAccess", weight: 40, mitre: ["T1566", "T1078", "T1566.002", "T1190"] },
  { name: "SuspiciousActivity", weight: 18, mitre: ["T1078", "T1098"] },
  { name: "Exfiltration", weight: 13, mitre: ["T1567", "T1048"] },
  { name: "CommandAndControl", weight: 10, mitre: ["T1071", "T1568"] },
  { name: "Execution", weight: 6, mitre: ["T1059", "T1204"] },
  { name: "CredentialAccess", weight: 5, mitre: ["T1110", "T1003"] },
  { name: "Malware", weight: 4, mitre: ["T1204.002"] },
  { name: "Discovery", weight: 2, mitre: ["T1087", "T1046"] },
  { name: "LateralMovement", weight: 2, mitre: ["T1021"] },
];

const ENTITY_TYPES = ["Ip", "User", "MailMessage", "Machine", "File", "Url", "CloudLogonRequest", "Mailbox", "Process"];

function pick<T>(random: () => number, items: T[], weights?: number[]): T {
  if (!weights) return items[Math.floor(random() * items.length)]!;
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

export function syntheticIncidents(count = 2400, seed = 20240603): SeedIncident[] {
  const random = rng(seed);

  // 48 detectors: volume falls off quickly with rank, and accuracy varies widely.
  const detectors = Array.from({ length: 48 }, (_, i) => {
    const category = pick(random, CATEGORIES, CATEGORIES.map((c) => c.weight)).name;
    const roll = random();
    // roughly a quarter of detectors are almost never right, a few are very reliable
    const tpRate = roll < 0.25 ? random() * 0.02 : roll > 0.88 ? 0.6 + random() * 0.35 : 0.05 + random() * 0.4;
    const benignShare = 0.35 + random() * 0.45; // of the non-threats, how many are benign positives
    return { id: i + 1, category, tpRate, benignShare, weight: 1 / (i + 1) ** 0.9 };
  });
  const detectorWeights = detectors.map((d) => d.weight);

  const start = Date.UTC(2024, 5, 3); // 3 June 2024
  const windowMs = 14 * 24 * 3_600_000;
  const openFrom = start + windowMs * 0.86; // the most recent incidents are left open

  const incidents: SeedIncident[] = [];
  for (let n = 0; n < count; n++) {
    const detector = pick(random, detectors, detectorWeights);
    const isThreat = random() < detector.tpRate;
    const grade: Grade = isThreat
      ? "true_positive"
      : random() < detector.benignShare
        ? "benign_positive"
        : "false_positive";

    // Real threats tend to carry more alerts.
    const alertCount = random() < (isThreat ? 0.45 : 0.9) ? 1 : 2 + Math.floor(random() ** 2 * (isThreat ? 14 : 4));
    const firstAt = start + random() * windowMs;
    const mitre = CATEGORIES.find((c) => c.name === detector.category)!.mitre;

    const alerts = Array.from({ length: alertCount }, (_, a) => {
      const sameDetector = a === 0 || random() < 0.85;
      const alertDetector = sameDetector ? detector : pick(random, detectors, detectorWeights);
      const evidenceCount = 1 + Math.floor(random() ** 2 * 8);
      return {
        detectorId: alertDetector.id,
        category: alertDetector.category,
        mitreTechniques: random() < 0.45 ? pick(random, mitre) : null,
        occurredAt: new Date(firstAt + a * random() * 45 * 60_000),
        evidence: Array.from({ length: evidenceCount }, () => {
          const v = random();
          const verdict = v < 0.7 ? null : v < 0.86 ? "Suspicious" : v < 0.93 ? "NoThreatsFound" : "Malicious";
          return {
            entityType: pick(random, ENTITY_TYPES),
            role: random() < 0.55 ? "Related" : "Impacted",
            verdict: isThreat && v > 0.8 ? "Malicious" : verdict,
          };
        }),
      };
    });

    incidents.push({
      externalRef: `INC-${String(100000 + n)}`,
      category: detector.category,
      detectorId: detector.id,
      grade: firstAt >= openFrom ? null : grade,
      alerts,
    });
  }
  return incidents;
}
