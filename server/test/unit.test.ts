import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";
import { bandFor } from "../src/priority.js";
import { parseCsvLine } from "../src/seed/guide.js";
import { categoryLabel } from "../src/seed/load.js";
import { syntheticIncidents } from "../src/seed/synthetic.js";

describe("priority bands", () => {
  it("maps scores to bands at the documented thresholds", () => {
    expect(bandFor(0.4)).toBe("high");
    expect(bandFor(0.399)).toBe("medium");
    expect(bandFor(0.15)).toBe("medium");
    expect(bandFor(0.149)).toBe("low");
    expect(bandFor(0)).toBe("low");
  });
});

describe("passwords", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    expect(await verifyPassword("anything", "malformed")).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});

describe("CSV parsing", () => {
  it("handles quoted fields, embedded commas and escaped quotes", () => {
    expect(parseCsvLine('1,"a,b",c')).toEqual(["1", "a,b", "c"]);
    expect(parseCsvLine('"say ""hi""",,x')).toEqual(['say "hi"', "", "x"]);
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

describe("seed data", () => {
  it("labels categories for display", () => {
    expect(categoryLabel("InitialAccess")).toBe("Initial Access");
    expect(categoryLabel("CommandAndControl")).toBe("Command and Control");
  });

  it("is deterministic and leaves the most recent incidents open", () => {
    const a = syntheticIncidents(300);
    const b = syntheticIncidents(300);
    expect(a.map((i) => i.grade)).toEqual(b.map((i) => i.grade));
    const open = a.filter((i) => i.grade === null).length;
    expect(open).toBeGreaterThan(10);
    expect(open).toBeLessThan(120);
    expect(a.every((i) => i.alerts.length >= 1)).toBe(true);
  });
});
