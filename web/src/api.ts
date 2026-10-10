// Typed client for the API. Every request is same-origin and carries the session cookie.

export type Role = "viewer" | "analyst" | "admin";
export type Status = "new" | "in_progress" | "closed";
export type Grade = "true_positive" | "benign_positive" | "false_positive";
export type Band = "high" | "medium" | "low";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
}

export interface Incident {
  id: number;
  externalRef: string;
  title: string;
  category: string;
  status: Status;
  grade: Grade | null;
  detectorId: number;
  detectorName: string;
  assigneeId: number | null;
  assigneeName: string | null;
  priorityScore: number;
  priorityBand: Band;
  alertCount: number;
  evidenceCount: number;
  firstSeenAt: string;
  updatedAt: string;
  closedAt: string | null;
  version: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IncidentEvent {
  id: number;
  type: "created" | "assigned" | "unassigned" | "status_changed" | "comment";
  detail: Record<string, unknown>;
  createdAt: string;
  actorName: string | null;
}

export interface IncidentDetail {
  incident: Incident;
  alerts: {
    id: number;
    category: string;
    mitreTechniques: string | null;
    occurredAt: string;
    detectorId: number;
    detectorName: string;
  }[];
  evidence: { entityType: string; role: string; verdict: string | null; count: number }[];
  events: IncidentEvent[];
  detectorHistory: { graded: number; truePositives: number };
}

export interface Dashboard {
  totals: { open: number; unassigned: number; inProgress: number; mine: number; closed: number; openHigh: number };
  byPriority: { band: Band; count: number }[];
  byCategory: { category: string; open: number; closed: number; truePositives: number }[];
  grades: { grade: Grade; count: number }[];
  workload: { id: number; name: string; open: number }[];
}

export interface Detector {
  id: number;
  name: string;
  category: string;
  incidents: number;
  open: number;
  graded: number;
  truePositives: number;
  benignPositives: number;
  falsePositives: number;
}

export interface AuditEntry extends IncidentEvent {
  incidentId: number;
  externalRef: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? "Request failed.");
  }
  return body as T;
}

const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });

export interface QueueFilters {
  status?: Status | "open";
  priority?: Band;
  category?: string;
  assignee?: string;
  q?: string;
  sort?: "priority" | "newest" | "oldest";
  page?: number;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export const api = {
  me: () => request<{ user: User }>("/auth/me"),
  login: (email: string, password: string) => post<{ user: User }>("/auth/login", { email, password }),
  logout: () => post<{ ok: true }>("/auth/logout"),
  demoAccounts: () => request<{ enabled: boolean; accounts: Omit<User, "id">[] }>("/auth/demo"),
  demoLogin: (email: string) => post<{ user: User }>("/auth/demo", { email }),

  incidents: (filters: QueueFilters) => request<Page<Incident>>(`/incidents${toQuery({ ...filters })}`),
  categories: () => request<string[]>("/incidents/categories"),
  incident: (id: number) => request<IncidentDetail>(`/incidents/${id}`),
  assign: (id: number, assigneeId: number | null, version: number) =>
    post<{ ok: true }>(`/incidents/${id}/assign`, { assigneeId, version }),
  setStatus: (id: number, status: Status, version: number, grade?: Grade) =>
    post<{ ok: true }>(`/incidents/${id}/status`, { status, version, grade }),
  comment: (id: number, body: string) => post<{ ok: true }>(`/incidents/${id}/comments`, { body }),

  dashboard: () => request<Dashboard>("/dashboard"),
  detectors: () => request<Detector[]>("/detectors"),
  users: () => request<{ id: number; name: string; role: Role }[]>("/users"),
  audit: (page: number) => request<Page<AuditEntry>>(`/audit${toQuery({ page })}`),
};
