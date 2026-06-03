// POST /api/crons/generate-weekly-pnl — task G14
// Called by Coolify's Sunday 23:59 SAST cron (or manually by admin).
// Protected by CRON_SECRET header.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateWeeklyPnL } from "@/server/crons/generate-weekly-pnl";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await generateWeeklyPnL();
  return NextResponse.json({ ok: true, ...result });
}
