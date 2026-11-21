import { describe, expect, it } from "vitest";
import { assignmentStatus, isUpdated, progress } from "../src/rollup";

describe("assignmentStatus", () => {
  it("is not_started with no comments", () => {
    expect(assignmentStatus([])).toBe("not_started");
  });
  it("is open when any comment is open", () => {
    expect(assignmentStatus(["done", "open", "in_progress"])).toBe("open");
  });
  it("is in_progress when none open but some in progress", () => {
    expect(assignmentStatus(["in_progress", "done"])).toBe("in_progress");
  });
  it("is done when everything is settled", () => {
    expect(assignmentStatus(["done", "later"])).toBe("done");
    expect(assignmentStatus(["kept"])).toBe("done");
  });
});

describe("progress", () => {
  it("is zero when empty", () => {
    expect(progress([])).toBe(0);
  });
  it("is settled over total", () => {
    expect(progress(["done", "open", "kept", "later"])).toBe(0.75);
  });
});

describe("isUpdated", () => {
  it("is false when never opened", () => {
    expect(isUpdated(null, ["2026-11-20T11:00:00Z"])).toBe(false);
  });
  it("is true when a change is after the last open", () => {
    expect(isUpdated("2026-11-20T10:00:00Z", ["2026-11-20T11:00:00Z"])).toBe(true);
  });
  it("is false when all changes are before or at the last open", () => {
    expect(isUpdated("2026-11-20T10:00:00Z", ["2026-11-20T09:00:00Z", "2026-11-20T10:00:00Z"])).toBe(false);
    expect(isUpdated("2026-11-20T10:00:00Z", [])).toBe(false);
  });
});
