// One auth scheme for every manual /api/crons/* trigger (AT-169):
//   POST, `Authorization: Bearer <CRON_SECRET>`, compared in constant time.
// The scheduler calls jobs in-process and never goes through these routes.
// An unset CRON_SECRET answers 503 — loud — rather than 401-ing forever.

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Returns a response to send if the request is not authorised, else null. */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  // Hashing both sides first keeps the comparison constant-time regardless of length.
  if (!timingSafeEqual(digest(header), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
