// POST /api/crons/close-daily — manual trigger for closeDaily.
// Scheduled at 00:05 SAST for the completed day by the in-app scheduler (src/server/jobs/registry.ts); a manual call closes the current SAST day.
// Auth: Authorization: Bearer $CRON_SECRET (see src/server/jobs/cron-auth.ts).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { closeDaily } from "@/server/crons/close-daily";
import { requireCronSecret } from "@/server/jobs/cron-auth";

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const result = await closeDaily();
  return NextResponse.json({ ok: true, ...result });
}
