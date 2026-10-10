import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.db.close();
});

async function eventCount(incidentId: number): Promise<number> {
  const [row] = await ctx.db.query<{ n: number }>(
    "SELECT COUNT(*)::INT AS n FROM incident_events WHERE incident_id = $1",
    [incidentId],
  );
  return row!.n;
}

describe("authentication", () => {
  it("rejects requests without a session", async () => {
    const res = await request(ctx.app).get("/api/incidents");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthenticated");
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const unknown = await request(ctx.app).post("/api/auth/login").send({ email: "nobody@soc.test", password: "x" });
    const wrong = await request(ctx.app).post("/api/auth/login").send({ email: "admin@soc.test", password: "x" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it("signs in and sets an httpOnly session cookie", async () => {
    const agent = await ctx.as("analyst");
    const me = await agent.get("/api/auth/me");
    expect(me.body.user).toMatchObject({ email: "analyst@soc.test", role: "analyst" });

    const login = await request(ctx.app)
      .post("/api/auth/login")
      .send({ email: "analyst@soc.test", password: (await import("../src/seed/demo-users.js")).demoPassword() });
    const cookie = String(login.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("rejects a tampered session token", async () => {
    const res = await request(ctx.app).get("/api/auth/me").set("Cookie", "soc_session=not.a.real.token");
    expect(res.status).toBe(401);
  });

  it("locks out sign-in after repeated failures", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(ctx.app).post("/api/auth/login").send({ email: "locked@soc.test", password: "wrong" });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it("never returns password hashes", async () => {
    const agent = await ctx.as("admin");
    const users = await agent.get("/api/users");
    expect(JSON.stringify(users.body)).not.toContain("password");
  });
});

describe("queue", () => {
  it("sorts open incidents by priority, reliable detector first", async () => {
    const agent = await ctx.as("viewer");
    const res = await agent.get("/api/incidents").query({ status: "new", sort: "priority" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(6);
    const refs: string[] = res.body.items.map((i: { externalRef: string }) => i.externalRef);
    expect(refs.slice(0, 3).every((r) => r.startsWith("D1-OPEN"))).toBe(true);
    expect(refs.slice(3).every((r) => r.startsWith("D2-OPEN"))).toBe(true);
    const scores: number[] = res.body.items.map((i: { priorityScore: number }) => i.priorityScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("filters by priority band and category", async () => {
    const agent = await ctx.as("viewer");
    const high = await agent.get("/api/incidents").query({ status: "new", priority: "high" });
    expect(high.body.items.every((i: { detectorId: number }) => i.detectorId === 1)).toBe(true);
    const exfil = await agent.get("/api/incidents").query({ category: "Exfiltration" });
    expect(exfil.body.total).toBe(13);
  });

  it("paginates", async () => {
    const agent = await ctx.as("viewer");
    const page1 = await agent.get("/api/incidents").query({ pageSize: 5, page: 1, sort: "oldest" });
    const page2 = await agent.get("/api/incidents").query({ pageSize: 5, page: 2, sort: "oldest" });
    expect(page1.body.items).toHaveLength(5);
    expect(page1.body.total).toBe(26);
    const ids1 = page1.body.items.map((i: { id: number }) => i.id);
    const ids2 = page2.body.items.map((i: { id: number }) => i.id);
    expect(ids1.some((id: number) => ids2.includes(id))).toBe(false);
  });

  it("treats search text literally, including SQL wildcards", async () => {
    const agent = await ctx.as("viewer");
    const match = await agent.get("/api/incidents").query({ q: "D1-OPEN" });
    expect(match.body.total).toBe(3);
    const wildcard = await agent.get("/api/incidents").query({ q: "%" });
    expect(wildcard.body.total).toBe(0);
    const injection = await agent.get("/api/incidents").query({ q: "' OR 1=1 --" });
    expect(injection.status).toBe(200);
    expect(injection.body.total).toBe(0);
  });

  it("rejects invalid query parameters", async () => {
    const agent = await ctx.as("viewer");
    const res = await agent.get("/api/incidents").query({ status: "bogus", pageSize: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  });

  it("returns alerts, evidence, history and the detector's track record for an incident", async () => {
    const agent = await ctx.as("viewer");
    const { id } = await ctx.find("D1-OPEN-0");
    const res = await agent.get(`/api/incidents/${id}`);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.evidence.length).toBeGreaterThan(0);
    expect(res.body.events[0].type).toBe("created");
    expect(res.body.detectorHistory).toEqual({ graded: 10, truePositives: 8 });
    expect((await agent.get("/api/incidents/999999")).status).toBe(404);
    expect((await agent.get("/api/incidents/abc")).status).toBe(400);
  });
});

describe("roles", () => {
  it("does not let a viewer change anything", async () => {
    const agent = await ctx.as("viewer");
    const target = await ctx.find("D2-OPEN-0");
    const before = await eventCount(target.id);
    const assign = await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: 1, version: target.version });
    const status = await agent
      .post(`/api/incidents/${target.id}/status`)
      .send({ status: "in_progress", version: target.version });
    const comment = await agent.post(`/api/incidents/${target.id}/comments`).send({ body: "hello" });
    expect([assign.status, status.status, comment.status]).toEqual([403, 403, 403]);
    expect(await eventCount(target.id)).toBe(before);
  });

  it("lets an analyst take an incident but not hand it to someone else", async () => {
    const agent = await ctx.as("analyst");
    const me = await ctx.userId("analyst@soc.test");
    const other = await ctx.userId("analyst2@soc.test");
    const target = await ctx.find("D2-OPEN-1");

    const toOther = await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: other, version: target.version });
    expect(toOther.status).toBe(403);

    const take = await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: me, version: target.version });
    expect(take.status).toBe(200);
  });

  it("lets an admin assign anyone except a viewer", async () => {
    const agent = await ctx.as("admin");
    const analyst2 = await ctx.userId("analyst2@soc.test");
    const viewer = await ctx.userId("viewer@soc.test");
    let target = await ctx.find("D2-OPEN-2");

    const toViewer = await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: viewer, version: target.version });
    expect(toViewer.status).toBe(400);

    const ok = await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: analyst2, version: target.version });
    expect(ok.status).toBe(200);
    target = await ctx.find("D2-OPEN-2");
    expect(target.version).toBe(2);
  });

  it("restricts the audit log to admins", async () => {
    expect((await (await ctx.as("analyst")).get("/api/audit")).status).toBe(403);
    const res = await (await ctx.as("admin")).get("/api/audit");
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toHaveProperty("actorName");
  });
});

describe("incident workflow", () => {
  it("requires an analyst to take an incident before working it", async () => {
    const agent = await ctx.as("analyst2");
    const target = await ctx.find("D1-OPEN-0");
    const res = await agent.post(`/api/incidents/${target.id}/status`).send({ status: "in_progress", version: target.version });
    expect(res.status).toBe(403);
  });

  it("moves new -> in progress -> closed and records every step", async () => {
    const agent = await ctx.as("analyst");
    const me = await ctx.userId("analyst@soc.test");
    let target = await ctx.find("D1-OPEN-0");
    const before = await eventCount(target.id);

    await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: me, version: target.version }).expect(200);
    target = await ctx.find("D1-OPEN-0");
    await agent.post(`/api/incidents/${target.id}/status`).send({ status: "in_progress", version: target.version }).expect(200);
    target = await ctx.find("D1-OPEN-0");

    const noGrade = await agent.post(`/api/incidents/${target.id}/status`).send({ status: "closed", version: target.version });
    expect(noGrade.status).toBe(400);

    await agent
      .post(`/api/incidents/${target.id}/status`)
      .send({ status: "closed", grade: "true_positive", version: target.version })
      .expect(200);
    await agent.post(`/api/incidents/${target.id}/comments`).send({ body: "Confirmed phishing, account reset." }).expect(201);

    const detail = await agent.get(`/api/incidents/${target.id}`);
    expect(detail.body.incident).toMatchObject({ status: "closed", grade: "true_positive" });
    expect(detail.body.incident.closedAt).not.toBeNull();
    const types = detail.body.events.map((e: { type: string }) => e.type);
    expect(types.slice(-4)).toEqual(["assigned", "status_changed", "status_changed", "comment"]);
    // the rejected close attempt must not have left a trace
    expect(await eventCount(target.id)).toBe(before + 4);
  });

  it("refuses to reassign a closed incident or move it back to new", async () => {
    const agent = await ctx.as("admin");
    const target = await ctx.find("D1-OPEN-0");
    const analyst2 = await ctx.userId("analyst2@soc.test");
    const reassign = await agent.post(`/api/incidents/${target.id}/assign`).send({ assigneeId: analyst2, version: target.version });
    expect(reassign.status).toBe(409);
    expect(reassign.body.error.code).toBe("incident_closed");
    const backToNew = await agent.post(`/api/incidents/${target.id}/status`).send({ status: "new", version: target.version });
    expect(backToNew.status).toBe(409);
  });

  it("clears the grade when an incident is reopened", async () => {
    const agent = await ctx.as("admin");
    const target = await ctx.find("D1-OPEN-0");
    await agent.post(`/api/incidents/${target.id}/status`).send({ status: "in_progress", version: target.version }).expect(200);
    const detail = await agent.get(`/api/incidents/${target.id}`);
    expect(detail.body.incident).toMatchObject({ status: "in_progress", grade: null, closedAt: null });
  });

  it("rejects a write based on a stale version", async () => {
    const admin = await ctx.as("admin");
    const analyst2 = await ctx.userId("analyst2@soc.test");
    const stale = await ctx.find("D1-OPEN-1");
    // someone else changes the incident first
    await admin.post(`/api/incidents/${stale.id}/assign`).send({ assigneeId: analyst2, version: stale.version }).expect(200);
    const before = await eventCount(stale.id);

    const res = await admin.post(`/api/incidents/${stale.id}/status`).send({ status: "in_progress", version: stale.version });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("version_conflict");
    expect((await ctx.find("D1-OPEN-1")).status).toBe("new");
    expect(await eventCount(stale.id)).toBe(before);
  });
});

describe("priority scoring", () => {
  it("scores the reliable detector's incidents above the noisy detector's", async () => {
    const reliable = await ctx.find("D1-OPEN-2");
    const noisy = await ctx.find("D2-OPEN-0");
    // detector 1: (8 + 20 * 0.4) / (10 + 20) = 0.533; detector 2: (0 + 20 * 0.4) / 30 = 0.267
    expect(reliable.priorityScore).toBeCloseTo(0.533, 2);
    expect(noisy.priorityScore).toBeCloseTo(0.267, 2);
  });

  it("re-ranks a detector's open incidents when one of them is graded", async () => {
    const admin = await ctx.as("admin");
    const sibling = "D2-OPEN-1";
    const before = (await ctx.find(sibling)).priorityScore;

    // Close a noisy-detector incident as a true positive: its track record improves.
    const target = await ctx.find("D2-OPEN-0");
    await admin
      .post(`/api/incidents/${target.id}/status`)
      .send({ status: "closed", grade: "true_positive", version: target.version })
      .expect(200);
    const afterTp = (await ctx.find(sibling)).priorityScore;
    expect(afterTp).toBeGreaterThan(before);

    // Reopening withdraws the grade, and the score returns to where it was.
    const closed = await ctx.find("D2-OPEN-0");
    await admin.post(`/api/incidents/${closed.id}/status`).send({ status: "in_progress", version: closed.version }).expect(200);
    expect((await ctx.find(sibling)).priorityScore).toBeCloseTo(before, 5);
  });
});

describe("dashboard and detectors", () => {
  it("summarises the queue", async () => {
    const agent = await ctx.as("viewer");
    const res = await agent.get("/api/dashboard");
    expect(res.status).toBe(200);
    expect(res.body.totals.open + res.body.totals.closed).toBe(26);
    expect(res.body.byCategory.length).toBe(2);
  });

  it("reports each detector's track record", async () => {
    const agent = await ctx.as("viewer");
    const res = await agent.get("/api/detectors");
    const noisy = res.body.find((d: { id: number }) => d.id === 2);
    expect(noisy.truePositives).toBe(0);
    expect(noisy.benignPositives + noisy.falsePositives).toBe(noisy.graded);
  });

  it("returns 404 for unknown API routes", async () => {
    const agent = await ctx.as("viewer");
    expect((await agent.get("/api/nope")).status).toBe(404);
  });
});
