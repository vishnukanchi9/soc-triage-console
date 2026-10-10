import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, type Grade, type IncidentDetail, type IncidentEvent } from "../api";
import { useAuth } from "../auth";
import { ErrorState, GradeBadge, Loading, PriorityBadge, ShareBar, StatusBadge } from "../components/ui";
import { GRADE_HELP, GRADE_LABEL, STATUS_LABEL, categoryLabel, count, dateTime, hitRate } from "../format";

const GRADES: Grade[] = ["true_positive", "benign_positive", "false_positive"];

export function IncidentPage() {
  const id = Number(useParams().id);
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);

  const query = useQuery({ queryKey: ["incident", id], queryFn: () => api.incident(id), enabled: Number.isFinite(id) });
  const users = useQuery({ queryKey: ["users"], queryFn: api.users, staleTime: 300_000, enabled: can("admin") });

  /** Runs a change, then refreshes everything that depends on it. */
  const mutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      setClosing(false);
      setGrade(null);
    },
    onError: (err) => {
      // Someone else changed the incident first: say so and show the latest state.
      setNotice(err instanceof ApiError ? err.message : "The change could not be saved.");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", id] });
      void queryClient.invalidateQueries({ queryKey: ["incidents"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["detectors"] });
    },
  });

  if (!Number.isFinite(id)) return <ErrorState error={new Error("That is not a valid incident.")} />;
  if (query.isPending) return <Loading label="Loading incident" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const { incident, alerts, evidence, events, detectorHistory } = query.data;
  const canEdit = can("analyst", "admin");
  const isMine = incident.assigneeId === user?.id;
  const canWork = can("admin") || isMine;
  const open = incident.status !== "closed";
  const busy = mutation.isPending;
  const rate = hitRate(detectorHistory.truePositives, detectorHistory.graded);

  return (
    <>
      <Link className="back-link" to="/queue">
        ← Back to queue
      </Link>

      <header className="page-header">
        <div>
          <div className="mono muted">{incident.externalRef}</div>
          <h1>{incident.title}</h1>
          <div className="badge-row">
            <PriorityBadge band={incident.priorityBand} score={incident.priorityScore} />
            <StatusBadge status={incident.status} />
            {incident.grade && <GradeBadge grade={incident.grade} />}
          </div>
        </div>
      </header>

      {notice && (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card" aria-labelledby="why-heading">
            <h2 id="why-heading">Why this priority</h2>
            {rate === null ? (
              <p>
                Detector <span className="mono">{incident.detectorName}</span> has no graded incidents yet, so this
                incident is scored at the overall average.
              </p>
            ) : (
              <>
                <p>
                  Detector <span className="mono">{incident.detectorName}</span> has opened{" "}
                  <strong>{count(detectorHistory.graded)}</strong> graded incidents.{" "}
                  <strong>{count(detectorHistory.truePositives)}</strong> were real threats.
                </p>
                <ShareBar value={rate} label="Share of this detector's graded incidents that were real threats" />
              </>
            )}
            <p className="muted small">
              The score blends this record with the overall rate, so a detector with little history is not over-trusted.
              It updates whenever one of the detector's incidents is graded.
            </p>
          </section>

          <section className="card" aria-labelledby="alerts-heading">
            <h2 id="alerts-heading">
              Alerts <span className="muted">({alerts.length})</span>
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Category</th>
                    <th scope="col">Detector</th>
                    <th scope="col">MITRE ATT&amp;CK</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.slice(0, 50).map((alert) => (
                    <tr key={alert.id}>
                      <td className="nowrap">{dateTime(alert.occurredAt)}</td>
                      <td>{categoryLabel(alert.category)}</td>
                      <td className="mono">{alert.detectorName}</td>
                      <td className="mono">{alert.mitreTechniques?.split(";").join(", ") ?? <span className="muted">None</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {alerts.length > 50 && <p className="muted small">Showing the first 50 of {alerts.length} alerts.</p>}
          </section>

          <section className="card" aria-labelledby="evidence-heading">
            <h2 id="evidence-heading">
              Evidence <span className="muted">({count(incident.evidenceCount)} items)</span>
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Entity</th>
                    <th scope="col">Role</th>
                    <th scope="col">Verdict</th>
                    <th scope="col" className="num">
                      Items
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.map((row) => (
                    <tr key={`${row.entityType}-${row.role}-${row.verdict}`}>
                      <td>{categoryLabel(row.entityType)}</td>
                      <td>{row.role}</td>
                      <td>
                        {row.verdict ? (
                          <span className={row.verdict === "Malicious" ? "verdict verdict-bad" : "verdict"}>
                            {categoryLabel(row.verdict)}
                          </span>
                        ) : (
                          <span className="muted">None</span>
                        )}
                      </td>
                      <td className="num">{count(row.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card" aria-labelledby="activity-heading">
            <h2 id="activity-heading">Activity</h2>
            <ol className="timeline">
              {events.map((event) => (
                <li key={event.id}>
                  <div className="timeline-meta">
                    <strong>{event.actorName ?? "System"}</strong>
                    <span className="muted">{dateTime(event.createdAt)}</span>
                  </div>
                  <div>{describeEvent(event)}</div>
                </li>
              ))}
            </ol>
            {canEdit && <CommentForm onSubmit={(body) => mutation.mutateAsync(() => api.comment(incident.id, body))} busy={busy} />}
          </section>
        </div>

        <aside className="detail-side">
          <section className="card" aria-labelledby="actions-heading">
            <h2 id="actions-heading">Triage</h2>
            <dl className="facts">
              <dt>Assignee</dt>
              <dd>{incident.assigneeName ?? "Unassigned"}</dd>
              <dt>Category</dt>
              <dd>{categoryLabel(incident.category)}</dd>
              <dt>First seen</dt>
              <dd>{dateTime(incident.firstSeenAt)}</dd>
              {incident.closedAt && (
                <>
                  <dt>Closed</dt>
                  <dd>{dateTime(incident.closedAt)}</dd>
                </>
              )}
            </dl>

            {!canEdit && <p className="muted small">Your role is read-only.</p>}

            {canEdit && open && (
              <div className="actions">
                {!incident.assigneeId && (
                  <button
                    className="btn btn-primary btn-block"
                    disabled={busy}
                    onClick={() => mutation.mutate(() => api.assign(incident.id, user!.id, incident.version))}
                  >
                    Take incident
                  </button>
                )}
                {isMine && (
                  <button
                    className="btn btn-block"
                    disabled={busy}
                    onClick={() => mutation.mutate(() => api.assign(incident.id, null, incident.version))}
                  >
                    Release
                  </button>
                )}
                {can("admin") && users.data && (
                  <div className="field">
                    <label htmlFor="assign">Assign to</label>
                    <select
                      id="assign"
                      disabled={busy}
                      value={incident.assigneeId ?? ""}
                      onChange={(e) =>
                        mutation.mutate(() =>
                          api.assign(incident.id, e.target.value ? Number(e.target.value) : null, incident.version),
                        )
                      }
                    >
                      <option value="">Unassigned</option>
                      {users.data
                        .filter((u) => u.role !== "viewer")
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {incident.status === "new" && (
                  <button
                    className="btn btn-block"
                    disabled={busy || !canWork}
                    onClick={() => mutation.mutate(() => api.setStatus(incident.id, "in_progress", incident.version))}
                  >
                    Start work
                  </button>
                )}

                {!closing ? (
                  <button className="btn btn-block" disabled={busy || !canWork} onClick={() => setClosing(true)}>
                    Close incident
                  </button>
                ) : (
                  <form
                    className="close-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (grade) mutation.mutate(() => api.setStatus(incident.id, "closed", incident.version, grade));
                    }}
                  >
                    <fieldset>
                      <legend>What did you find?</legend>
                      {GRADES.map((g) => (
                        <label key={g} className="radio">
                          <input type="radio" name="grade" value={g} checked={grade === g} onChange={() => setGrade(g)} />
                          <span>
                            <strong>{GRADE_LABEL[g]}</strong>
                            <span className="muted small">{GRADE_HELP[g]}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="button-row">
                      <button className="btn btn-primary" type="submit" disabled={busy || !grade}>
                        Close
                      </button>
                      <button className="btn btn-quiet" type="button" onClick={() => setClosing(false)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
                {!canWork && <p className="muted small">Take the incident to change its status.</p>}
              </div>
            )}

            {canEdit && !open && (
              <div className="actions">
                <button
                  className="btn btn-block"
                  disabled={busy || !canWork}
                  onClick={() => mutation.mutate(() => api.setStatus(incident.id, "in_progress", incident.version))}
                >
                  Reopen
                </button>
                {!canWork && <p className="muted small">Only the assignee or an admin can reopen this incident.</p>}
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

function CommentForm({ onSubmit, busy }: { onSubmit: (body: string) => Promise<unknown>; busy: boolean }) {
  const [body, setBody] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    try {
      await onSubmit(text);
      setBody("");
    } catch {
      // the page-level notice reports the failure; keep the text so it is not lost
    }
  }
  return (
    <form className="comment-form" onSubmit={(e) => void submit(e)}>
      <label htmlFor="comment">Add a note</label>
      <textarea id="comment" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn" type="submit" disabled={busy || !body.trim()}>
        Add note
      </button>
    </form>
  );
}

export function describeEvent(event: IncidentEvent | IncidentDetail["events"][number]) {
  const d = event.detail as { to?: string; toName?: string | null; grade?: Grade | null; body?: string; from?: string };
  switch (event.type) {
    case "created":
      return "Incident created.";
    case "assigned":
      return `Assigned to ${d.toName ?? "an analyst"}.`;
    case "unassigned":
      return "Released back to the queue.";
    case "status_changed": {
      const to = STATUS_LABEL[d.to as keyof typeof STATUS_LABEL] ?? d.to;
      if (d.to === "closed" && d.grade) return `Closed as ${GRADE_LABEL[d.grade].toLowerCase()}.`;
      if (d.from === "closed") return "Reopened.";
      return `Status changed to ${String(to).toLowerCase()}.`;
    }
    case "comment":
      return <span className="comment-body">{d.body}</span>;
  }
}
