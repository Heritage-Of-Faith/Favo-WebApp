// SEC-5 / SEC-6 — small input guards for API routes and server actions, so
// malformed input gets a clean 4xx with a safe message instead of a bare 500.

/** True only for a real calendar date written YYYY-MM-DD (rejects 1999-13-45, 2026-02-30). */
export function isCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Days from `from` to `to`, counting both ends (same day = 1). Both must be calendar dates. */
export function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** Remove ASCII control characters (incl. NUL, which Postgres rejects in text). */
export function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, "");
}

export const MAX_JSON_BODY_BYTES = 100 * 1024; // ~100 KB

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 };

/**
 * Read and parse a JSON request body, refusing anything over `maxBytes`
 * (413) without buffering more than that, and bad JSON (400).
 * Checks Content-Length first, then counts bytes as they stream in, so a
 * missing or lying Content-Length cannot get past the cap.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<JsonBodyResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}
