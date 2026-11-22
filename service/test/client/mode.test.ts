// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { MODE_KEY, readMode, saveMode } from "../../client/overlay/mode";

const throwing = (): Window =>
  ({
    get sessionStorage(): Storage {
      throw new Error("blocked");
    },
  }) as unknown as Window;

describe("mode memory", () => {
  it("defaults to use", () => {
    window.sessionStorage.clear();
    expect(readMode(window)).toBe("use");
  });
  it("remembers comment after saveMode", () => {
    saveMode(window, "comment");
    expect(window.sessionStorage.getItem(MODE_KEY)).toBe("comment");
    expect(readMode(window)).toBe("comment");
  });
  it("remembers use after saveMode", () => {
    saveMode(window, "use");
    expect(window.sessionStorage.getItem(MODE_KEY)).toBe("use");
    expect(readMode(window)).toBe("use");
  });
  it("treats an unexpected stored value as use", () => {
    window.sessionStorage.setItem(MODE_KEY, "bogus");
    expect(readMode(window)).toBe("use");
  });
  it("gives use when storage getters throw", () => {
    expect(readMode(throwing())).toBe("use");
  });
  it("does not throw when setItem throws", () => {
    const win = { sessionStorage: { setItem: () => { throw new Error("full"); } } } as unknown as Window;
    expect(() => saveMode(win, "use")).not.toThrow();
    expect(() => saveMode(throwing(), "use")).not.toThrow();
  });
});
