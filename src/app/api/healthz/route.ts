// Extended healthz — AT-83 (G25)
// Checks Postgres, Yoco reachability, and Loki reachability.
// Returns 200 when all configured checks pass; 503 otherwise.
// Result is cached for 5 seconds to limit DB/external load from monitors.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const CACHE_TTL_MS = 5_000;

type CheckResult = { ok: boolean; latency_ms?: number; reason?: string };

interface HealthBody {
  ok: boolean;
  service: string;
  checks: {
    postgres: CheckResult;
    yoco: CheckResult;
    loki: CheckResult;
  };
  timestamp: string;
}

let cache: { at: number; body: HealthBody } | null = null;

async function checkPostgres(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      reason: err instanceof Error ? err.message : "unknown",
    };
  }
}

async function checkYoco(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // HEAD against the Yoco payments API base — doesn't require auth, just DNS + TLS.
    const res = await fetch("https://payments.yoco.com/api", {
      method: "HEAD",
      signal: AbortSignal.timeout(4_000),
    });
    return { ok: res.status < 500, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      reason: err instanceof Error ? err.message : "unreachable",
    };
  }
}

async function checkLoki(): Promise<CheckResult> {
  const lokiUrl = process.env.LOKI_URL;
  if (!lokiUrl) {
    // Loki not configured — skip gracefully (returns ok:true so healthz stays green)
    return { ok: true, reason: "not configured" };
  }
  const start = Date.now();
  try {
    const res = await fetch(`${lokiUrl}/ready`, {
      signal: AbortSignal.timeout(4_000),
    });
    return {
      ok: res.ok,
      latency_ms: Date.now() - start,
      reason: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      latency_ms: Date.now() - start,
      reason: err instanceof Error ? err.message : "unreachable",
    };
  }
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body, {
      status: cache.body.ok ? 200 : 503,
      headers: { "Cache-Control": "public, max-age=5" },
    });
  }

  const [postgres, yoco, loki] = await Promise.all([
    checkPostgres(),
    checkYoco(),
    checkLoki(),
  ]);

  const allOk = postgres.ok && yoco.ok && loki.ok;
  const body: HealthBody = {
    ok: allOk,
    service: "favo-webapp",
    checks: { postgres, yoco, loki },
    timestamp: new Date().toISOString(),
  };

  cache = { at: now, body };

  return NextResponse.json(body, {
    status: allOk ? 200 : 503,
    headers: { "Cache-Control": "public, max-age=5" },
  });
}
