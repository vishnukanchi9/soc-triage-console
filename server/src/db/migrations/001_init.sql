-- 001_init.sql
-- Core schema for the triage console.

CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('viewer', 'analyst', 'admin')),
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A detector is the rule or model that raises alerts.
CREATE TABLE detectors (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    category TEXT NOT NULL
);

CREATE TABLE incidents (
    id             SERIAL PRIMARY KEY,
    external_ref   TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    category       TEXT NOT NULL,
    detector_id    INTEGER NOT NULL REFERENCES detectors (id),
    status         TEXT NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'in_progress', 'closed')),
    -- set when an incident is closed: what the analyst concluded
    grade          TEXT CHECK (grade IN ('true_positive', 'benign_positive', 'false_positive')),
    assignee_id    INTEGER REFERENCES users (id),
    -- likelihood this incident is a real threat, from its detector's track record
    priority_score REAL NOT NULL DEFAULT 0,
    alert_count    INTEGER NOT NULL DEFAULT 0,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    first_seen_at  TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at      TIMESTAMPTZ,
    -- optimistic locking: every write bumps the version and must quote the one it read
    version        INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT closed_incidents_are_graded
        CHECK ((status = 'closed') = (grade IS NOT NULL AND closed_at IS NOT NULL))
);

CREATE INDEX incidents_queue_idx    ON incidents (status, priority_score DESC, first_seen_at DESC);
CREATE INDEX incidents_assignee_idx ON incidents (assignee_id) WHERE status <> 'closed';
CREATE INDEX incidents_detector_idx ON incidents (detector_id);
CREATE INDEX incidents_category_idx ON incidents (category);

CREATE TABLE alerts (
    id               SERIAL PRIMARY KEY,
    incident_id      INTEGER NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    detector_id      INTEGER NOT NULL REFERENCES detectors (id),
    category         TEXT NOT NULL,
    mitre_techniques TEXT,
    occurred_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX alerts_incident_idx ON alerts (incident_id, occurred_at);

CREATE TABLE evidence (
    id          SERIAL PRIMARY KEY,
    alert_id    INTEGER NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    role        TEXT NOT NULL,
    verdict     TEXT
);

CREATE INDEX evidence_alert_idx ON evidence (alert_id);

-- Append-only audit trail. Every change to an incident writes a row here in the
-- same transaction as the change itself.
CREATE TABLE incident_events (
    id          SERIAL PRIMARY KEY,
    incident_id INTEGER NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    actor_id    INTEGER REFERENCES users (id),
    type        TEXT NOT NULL
                    CHECK (type IN ('created', 'assigned', 'unassigned', 'status_changed', 'comment')),
    detail      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX incident_events_incident_idx ON incident_events (incident_id, created_at);
CREATE INDEX incident_events_recent_idx   ON incident_events (created_at DESC);
