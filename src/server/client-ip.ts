// SEC-1 — the client key used by the auth limits. The client must never be
// able to choose its own key.
//
// X-Forwarded-For is a list: "<what the client sent>, ..., <what each proxy saw>".
// Only the entries appended by proxies we run can be trusted, so the key is
// the entry the outermost trusted proxy appended: the TRUSTED_PROXY_HOPS-th
// entry from the end (default 1: one reverse proxy). If the chain is shorter
// than that, the right-most entry is used — never the first, which is the one
// the client wrote. CF-Connecting-IP is preferred only when the chain shows the
// request really came through all the trusted hops.
//
// TRUSTED_PROXY_HOPS=0 means nothing sits in front of Next. Then every header
// is client-written, and the socket address is what should be used — but a
// Next 16 server action cannot read the socket: Next only copies it into
// X-Forwarded-For when that header is absent (next/dist/server/base-server.js,
// `x-forwarded-for ??= socket.remoteAddress`), so a client that sends its own
// header hides it. Rather than trust a client-written value, hops=0 gives every
// caller one shared key ("direct").

import { headers } from "next/headers";

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const SHARED_KEY = "direct";

export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_TRUSTED_PROXY_HOPS;
}

/** Unwrap ::ffff:a.b.c.d, strip ports and brackets. Null for empty input. */
export function normaliseAddress(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (bracketed) s = bracketed[1]!;
  else if (/^[\d.]+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(s);
  if (mapped) s = mapped[1]!;
  return s.toLowerCase();
}

export function clientKeyFrom(
  h: { forwardedFor: string | null | undefined; cfConnectingIp?: string | null },
  hops: number
): string {
  if (hops <= 0) return SHARED_KEY;
  const entries = (h.forwardedFor ?? "")
    .split(",")
    .map(normaliseAddress)
    .filter((e): e is string => e !== null);
  if (entries.length === 0) return SHARED_KEY;

  if (entries.length >= hops && h.cfConnectingIp) {
    const cf = normaliseAddress(h.cfConnectingIp);
    if (cf) return cf;
  }
  return entries.length >= hops ? entries[entries.length - hops]! : entries[entries.length - 1]!;
}

/** Rate-limit key for the current request. Never throws. */
export async function clientKey(): Promise<string> {
  try {
    const h = await headers();
    return clientKeyFrom(
      { forwardedFor: h.get("x-forwarded-for"), cfConnectingIp: h.get("cf-connecting-ip") },
      trustedProxyHops()
    );
  } catch {
    return SHARED_KEY;
  }
}
