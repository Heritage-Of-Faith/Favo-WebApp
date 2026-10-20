// POST /api/crons/check-low-stock — manual trigger for checkLowStock.
// Scheduled every 15 min by the in-app scheduler (src/server/jobs/registry.ts).
// Auth: Authorization: Bearer $CRON_SECRET (see src/server/jobs/cron-auth.ts).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkLowStock } from "@/server/crons/check-low-stock";
import { requireCronSecret } from "@/server/jobs/cron-auth";

export async function POST(req: NextRequest) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const result = await checkLowStock();
  return NextResponse.json({ ok: true, ...result });
}
