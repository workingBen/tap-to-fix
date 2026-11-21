import { chmodSync, closeSync, ftruncateSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";

export function configPath(home) {
  return join(home, ".config", "tap-to-fix", "config.json");
}

/** Env (TTF_SERVICE + TTF_OWNER_TOKEN) wins; else the config file; else null. */
export function loadConfig({ env = process.env, home } = {}) {
  if (env.TTF_SERVICE && env.TTF_OWNER_TOKEN) {
    return { service: env.TTF_SERVICE.replace(/\/+$/, ""), owner_token: env.TTF_OWNER_TOKEN };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath(home), "utf8"));
    if (typeof raw.service === "string" && typeof raw.owner_token === "string") {
      return { service: raw.service.replace(/\/+$/, ""), owner_token: raw.owner_token };
    }
  } catch {
    // missing or unreadable: no config
  }
  return null;
}

export function saveConfig(cfg, { home }) {
  const file = configPath(home);
  const dir = join(home, ".config", "tap-to-fix");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fd = openSync(file, "a", 0o600); // created 0600; never written before the mode is right
  try {
    chmodSync(file, 0o600);
    ftruncateSync(fd, 0);
    writeSync(fd, JSON.stringify({ service: cfg.service, owner_token: cfg.owner_token }, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
  return file;
}
