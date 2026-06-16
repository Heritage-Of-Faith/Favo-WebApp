// Cron endpoint: retry deferred Yoco payments — task G22 (AT-63)
// Called by Vercel Cron (or cURL from CI) every 5 minutes.
// Auth: CRON_SECRET bearer token (env var).

import { NextResponse } from "next/server";
import { retryDeferredPayments } from "@/server/crons/retry-deferred-payments";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");

  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await retryDeferredPayments();
  return NextResponse.json({ ok: true, ...result });
}
