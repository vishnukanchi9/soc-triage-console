import { describe, expect, it } from "vitest";
import { categoryLabel, hitRate, isNoisy, percent } from "../format";
import { filtersFromParams } from "../pages/Queue";

describe("formatting", () => {
  it("labels categories", () => {
    expect(categoryLabel("InitialAccess")).toBe("Initial Access");
    expect(categoryLabel("CommandAndControl")).toBe("Command and Control");
  });

  it("formats shares", () => {
    expect(percent(0.826)).toBe("83%");
    expect(percent(0.0149, 1)).toBe("1.5%");
  });

  it("computes a detector's hit rate only when it has history", () => {
    expect(hitRate(8, 10)).toBe(0.8);
    expect(hitRate(0, 0)).toBeNull();
  });

  it("flags a detector as noisy only with enough graded incidents", () => {
    expect(isNoisy(0, 49)).toBe(false);
    expect(isNoisy(0, 50)).toBe(true);
    expect(isNoisy(1, 50)).toBe(false); // exactly 2% is not under the threshold
    expect(isNoisy(1, 100)).toBe(true);
  });
});

describe("queue filters in the URL", () => {
  it("defaults to open incidents sorted by priority", () => {
    expect(filtersFromParams(new URLSearchParams(""))).toMatchObject({ status: "open", sort: "priority", page: 1 });
  });

  it("reads every filter, and treats status=all as no status filter", () => {
    const filters = filtersFromParams(
      new URLSearchParams("status=all&priority=high&category=Exfiltration&assignee=me&q=abc&sort=newest&page=3"),
    );
    expect(filters).toEqual({
      status: undefined,
      priority: "high",
      category: "Exfiltration",
      assignee: "me",
      q: "abc",
      sort: "newest",
      page: 3,
    });
  });

  it("falls back to page 1 for a bad page number", () => {
    expect(filtersFromParams(new URLSearchParams("page=abc")).page).toBe(1);
  });
});
