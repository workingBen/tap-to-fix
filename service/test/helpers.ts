import type { Env } from "../src/env";
import { hashToken, newId, newToken } from "../src/ids";
import { call } from "./env";

export function ownerFetch(env: Env, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + env.OWNER_TOKEN);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return call(path, { ...init, headers }, env);
}

export function reviewerFetch(env: Env, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + token);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return call(path, { ...init, headers }, env);
}

export async function seedSite(env: Env, overrides: Partial<Record<"slug" | "name" | "origin" | "repo", string>> = {}) {
  const site = {
    slug: "greensprings",
    name: "Greensprings",
    origin: "https://greensprings.life",
    repo: "workingBen/longevity-tracker",
    ...overrides,
  };
  await env.DB.prepare(
    "INSERT INTO sites (slug, name, origin, repo, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(site.slug, site.name, site.origin, site.repo, new Date().toISOString())
    .run();
  return site;
}

export async function seedReviewer(env: Env, name: string): Promise<{ id: string; token: string }> {
  const id = newId();
  const token = newToken();
  await env.DB.prepare(
    "INSERT INTO reviewers (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, name, await hashToken(token), new Date().toISOString())
    .run();
  return { id, token };
}
