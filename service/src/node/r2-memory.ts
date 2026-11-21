// In-memory R2 stand-in for tests. Not bundled into the Worker.
type Stored = { bytes: Uint8Array; httpMetadata: { contentType?: string } };

function toBytes(value: unknown): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new TypeError("Unsupported R2 value");
}

function view(key: string, s: Stored) {
  return {
    key,
    size: s.bytes.byteLength,
    httpMetadata: { ...s.httpMetadata },
    async arrayBuffer() {
      return s.bytes.slice().buffer;
    },
    get body() {
      const bytes = s.bytes.slice();
      return new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      });
    },
  };
}

export function createR2(): R2Bucket {
  const store = new Map<string, Stored>();
  const r2 = {
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const s = { bytes: toBytes(value), httpMetadata: { ...(opts?.httpMetadata ?? {}) } };
      store.set(key, s);
      return view(key, s);
    },
    async get(key: string) {
      const s = store.get(key);
      return s ? view(key, s) : null;
    },
    async head(key: string) {
      const s = store.get(key);
      return s ? view(key, s) : null;
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
  return r2 as unknown as R2Bucket;
}
