// Reviewer tokens, sealed at rest so the owner can copy a reviewer's link again later.
// AES-256-GCM with the LINK_KEY Worker secret (32 bytes, base64url). The reviewer id is the
// additional data, so a sealed token copied onto another row will not open there.
// Auth never uses this: requireReviewer still matches token_hash.

const VERSION = "v1";

function fromBase64Url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importKey(linkKey: string | undefined): Promise<CryptoKey | null> {
  if (!linkKey) return null;
  const raw = fromBase64Url(linkKey);
  if (!raw || raw.length !== 32) return null;
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** True when LINK_KEY is a usable key. */
export async function hasLinkKey(linkKey: string | undefined): Promise<boolean> {
  return (await importKey(linkKey)) !== null;
}

/** "v1:<iv>:<ciphertext>", or null when there is no usable key. */
export async function sealToken(linkKey: string | undefined, reviewerId: string, token: string): Promise<string | null> {
  const key = await importKey(linkKey);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(reviewerId) }, key, enc.encode(token));
  return `${VERSION}:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(ct))}`;
}

/** The token, or null when it will not open (no key, another key, another reviewer, or damaged). */
export async function openToken(linkKey: string | undefined, reviewerId: string, sealed: string): Promise<string | null> {
  const key = await importKey(linkKey);
  if (!key) return null;
  const [v, ivText, ctText, ...rest] = sealed.split(":");
  if (v !== VERSION || !ivText || !ctText || rest.length) return null;
  const iv = fromBase64Url(ivText);
  const ct = fromBase64Url(ctText);
  if (!iv || iv.length !== 12 || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(reviewerId) }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
