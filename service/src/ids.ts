const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 21-char URL-safe random id. 64 symbols divide 256 evenly, so masking is unbiased. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  let id = "";
  for (const b of bytes) id += ALPHABET[b & 63];
  return id;
}

/** 32 random bytes as base64url (43 chars). */
export function newToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of the token, lowercase hex. */
export async function hashToken(t: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
