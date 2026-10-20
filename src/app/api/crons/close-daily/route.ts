// POST /api/crons/close-daily — manual trigger for closeDaily.
// Scheduled at 00:05 SAST for the completed day by the in-app scheduler (src/server/jobs/registry.ts).
// A manual call also closes the completed (previous) SAST day: closing today early would make the
// real 00:05 close a no-op, since a closed day is never closed twice (AT-193).
// Auth: Authorization: Bearer $CRON_SECRET (see src/server/jobs/cron-auth.ts).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { closeDaily } from "@/server/crons/close-daily";
import { requireCronSecret } from "@/server/jobs/cron-auth";
import { sastMiddayDaysBack } from "@/server/jobs/schedule";

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const result = await closeDaily(sastMiddayDaysBack(new Date(), 1));
  return NextResponse.json({ ok: true, ...result });
}
