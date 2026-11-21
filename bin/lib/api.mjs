export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

export function client(cfg, fetchImpl = fetch) {
  const base = cfg.service.replace(/\/+$/, "");
  const redact = (text) => (cfg.owner_token ? String(text).split(cfg.owner_token).join("[redacted]") : String(text));

  async function send(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer " + cfg.owner_token);
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let res;
    try {
      res = await fetchImpl(new Request(base + path, { ...init, headers }));
    } catch (e) {
      // Never include the request (it carries the token) in the message.
      throw new NetworkError("Could not reach " + base + (e instanceof Error && e.message ? " (" + redact(e.message) + ")" : ""));
    }
    if (!res.ok) {
      let message = "HTTP " + res.status;
      try {
        const body = await res.clone().json();
        if (body && typeof body.error === "string") message = body.error;
      } catch {
        // not JSON
      }
      throw new ApiError(res.status, redact(message));
    }
    return res;
  }

  const json = async (path, init) => {
    const res = await send(path, init);
    try {
      return await res.json();
    } catch {
      throw new ApiError(res.status, "The service returned a response that is not JSON");
    }
  };

  return {
    overview: () => json("/api/owner/overview"),
    sites: () => json("/api/owner/sites"),
    batch(reviewerId, site, statuses) {
      const q = new URLSearchParams({ reviewer: reviewerId, site });
      if (statuses && statuses.length) q.set("status", statuses.join(","));
      return json("/api/owner/batch?" + q);
    },
    patch: (id, body) =>
      json("/api/owner/comments/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) }),
    async screenshot(id) {
      try {
        const res = await send("/api/owner/comments/" + encodeURIComponent(id) + "/screenshot");
        return {
          bytes: new Uint8Array(await res.arrayBuffer()),
          type: res.headers.get("Content-Type") ?? "application/octet-stream",
        };
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  };
}
