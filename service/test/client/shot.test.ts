// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { takeScreenshot } from "../../client/overlay/shot";

it("exports takeScreenshot (behavior is covered in a real browser in Task 5)", () => {
  expect(typeof takeScreenshot).toBe("function");
});
