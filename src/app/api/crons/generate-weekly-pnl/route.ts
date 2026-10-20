// POST /api/crons/generate-weekly-pnl — manual trigger for generateWeeklyPnL.
// Scheduled Monday 06:00 SAST for the completed week by the in-app scheduler (src/server/jobs/registry.ts); a manual call reports the current week.
// Auth: Authorization: Bearer $CRON_SECRET (see src/server/jobs/cron-auth.ts).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateWeeklyPnL } from "@/server/crons/generate-weekly-pnl";
import { requireCronSecret } from "@/server/jobs/cron-auth";

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const result = await generateWeeklyPnL();
  return NextResponse.json({ ok: true, ...result });
}
