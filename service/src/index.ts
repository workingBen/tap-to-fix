import { Hono } from "hono";
import type { Env } from "./env";
import owner from "./routes/owner";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/owner", owner);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
  const message = status === 500 ? "Internal error" : err.message;
  return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 500);
});

export default app;
