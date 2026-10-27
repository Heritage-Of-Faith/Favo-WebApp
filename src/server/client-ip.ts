// SEC-1 — the client key used by the auth rate limiters.
//
// X-Forwarded-For is a list: "<what the client sent>, ..., <what each proxy saw>".
// The FIRST entry is whatever the client chose to send, so keying on it lets a
// client reset its own throttle by changing the header. Only entries appended
// by proxies we run can be trusted, so the key is the entry the outermost
// trusted proxy appended: the TRUSTED_PROXY_HOPS-th entry from the end.
//
// TRUSTED_PROXY_HOPS = how many reverse proxies we run in front of the Next
// server (default 1, one reverse proxy). Set 0 when nothing sits in front: the
// whole header is then client-controlled and every caller shares one key.
// Next itself only fills the header when it is absent, so with no proxy the
// last entry is still client-chosen — which is why PIN login also has a global
// failure budget that no key can dodge (see src/server/actions/auth.ts).

import { headers } from "next/headers";

const DEFAULT_TRUSTED_PROXY_HOPS = 1;

export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_TRUSTED_PROXY_HOPS;
}

export function clientKeyFromForwardedFor(header: string | null | undefined, hops: number): string {
  if (hops <= 0) return "anonymous";
  const entries = (header ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return "anonymous";
  // Shorter chain than expected: the first entry is the earliest one we have.
  return entries[Math.max(0, entries.length - hops)]!;
}

/** Rate-limit key for the current request. Never throws. */
export async function clientKey(): Promise<string> {
  try {
    const h = await headers();
    return clientKeyFromForwardedFor(h.get("x-forwarded-for"), trustedProxyHops());
  } catch {
    return "anonymous";
  }
}
