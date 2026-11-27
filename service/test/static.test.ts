import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

describe("client build", () => {
  beforeAll(() => {
    execFileSync("node", ["scripts/build-client.mjs"], { stdio: "inherit" });
  }, 60_000);

  it("writes public/t.js and public/overlay.js", () => {
    expect(existsSync("public/t.js")).toBe(true);
    expect(existsSync("public/overlay.js")).toBe(true);
  });

  it("writes _headers allowing cross-origin JS", () => {
    const h = readFileSync("public/_headers", "utf8");
    expect(h).toContain("/*.js");
    expect(h).toContain("Access-Control-Allow-Origin: *");
    expect(h).toContain("Referrer-Policy: no-referrer");
  });

  it("writes the dashboard shells and bundles", () => {
    for (const f of ["public/r/index.html", "public/o/index.html", "public/r/app.js", "public/o/app.js"])
      expect(existsSync(f), f).toBe(true);
    expect(readFileSync("public/r/index.html", "utf8")).toContain('name="referrer" content="no-referrer"');
  });

  it("gives the reviewer page a link preview: title, description and a 1200x630 image", () => {
    expect(existsSync("public/r/og.jpg")).toBe(true);
    const html = readFileSync("public/r/index.html", "utf8");
    expect(html).toContain('<meta property="og:title" content="Tap to Fix · Your pages to review">');
    expect(html).toContain('<meta property="og:image" content="/r/og.jpg">');
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("makes the preview image absolute when TTF_PUBLIC_URL is a plain https origin", () => {
    const env = { ...process.env, TTF_PUBLIC_URL: "https://tap-to-fix.example.workers.dev" };
    execFileSync("node", ["scripts/build-client.mjs"], { stdio: "ignore", env });
    expect(readFileSync("public/r/index.html", "utf8")).toContain(
      '<meta property="og:image" content="https://tap-to-fix.example.workers.dev/r/og.jpg">',
    );
    execFileSync("node", ["scripts/build-client.mjs"], { stdio: "ignore", env: { ...process.env, TTF_PUBLIC_URL: 'https://x.dev/"><script>' } });
    expect(readFileSync("public/r/index.html", "utf8")).toContain('<meta property="og:image" content="/r/og.jpg">');
    execFileSync("node", ["scripts/build-client.mjs"], { stdio: "ignore" });
  }, 60_000);

  it("gives both dashboards a tab icon, a home-screen icon and a manifest", () => {
    for (const page of ["public/r/index.html", "public/o/index.html"]) {
      const html = readFileSync(page, "utf8");
      expect(html, page).toContain('<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">');
      expect(html, page).toContain('<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32">');
      expect(html, page).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
      expect(html, page).toContain('<link rel="manifest" href="/icons/manifest.webmanifest">');
      expect(html, page).toContain('<meta name="apple-mobile-web-app-title" content="Tap to Fix">');
      expect(html, page).toContain('<meta name="theme-color" content="#2F6B4F">');
    }
    for (const f of ["favicon.svg", "favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"])
      expect(existsSync(`public/icons/${f}`), f).toBe(true);
    const manifest = JSON.parse(readFileSync("public/icons/manifest.webmanifest", "utf8"));
    expect(manifest.name).toBe("Tap to Fix");
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    // The reviewer's token rides in the URL fragment; a start_url would drop it and launch signed out.
    expect(manifest).not.toHaveProperty("start_url");
    expect(readFileSync("public/_headers", "utf8")).toContain("/icons/*\n  Cache-Control: public, max-age=86400");
  });

  it("keeps the loader at or under 1500 bytes", () => {
    expect(statSync("public/t.js").size).toBeLessThanOrEqual(1500);
  });
});
