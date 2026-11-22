/** Comment: a tap on the page marks a spot. Use: the page behaves as if the overlay weren't there. */
export type Mode = "comment" | "use";

export const MODE_KEY = "ttf:mode";

/** The remembered mode for this tab; anything missing or unexpected, or blocked storage, is "comment". */
export function readMode(win: Window): Mode {
  try {
    return win.sessionStorage.getItem(MODE_KEY) === "use" ? "use" : "comment";
  } catch {
    return "comment";
  }
}

export function saveMode(win: Window, m: Mode): void {
  try {
    win.sessionStorage.setItem(MODE_KEY, m);
  } catch {
    // Storage blocked or full: the mode just isn't remembered.
  }
}
