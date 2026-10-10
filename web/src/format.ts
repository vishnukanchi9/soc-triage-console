import type { Band, Grade, Status } from "./api";

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  in_progress: "In progress",
  closed: "Closed",
};

export const GRADE_LABEL: Record<Grade, string> = {
  true_positive: "True positive",
  benign_positive: "Benign positive",
  false_positive: "False positive",
};

export const GRADE_HELP: Record<Grade, string> = {
  true_positive: "A real threat.",
  benign_positive: "The detection was right, but the activity was harmless.",
  false_positive: "The detection was wrong.",
};

export const BAND_LABEL: Record<Band, string> = { high: "High", medium: "Medium", low: "Low" };

/** "InitialAccess" -> "Initial Access" */
export function categoryLabel(category: string): string {
  return category.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bAnd\b/g, "and");
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function count(value: number): string {
  return value.toLocaleString("en-US");
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Timestamps are shown in UTC, the convention for security operations logs. */
export function dateTime(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}

/** Share of a detector's graded incidents that were real threats, or null with no history. */
export function hitRate(truePositives: number, graded: number): number | null {
  return graded > 0 ? truePositives / graded : null;
}

/** Detectors with enough history that almost never find a real threat. */
export function isNoisy(truePositives: number, graded: number): boolean {
  return graded >= 50 && truePositives / graded < 0.02;
}
