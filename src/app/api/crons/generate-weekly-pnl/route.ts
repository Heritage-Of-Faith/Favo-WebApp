// POST /api/crons/generate-weekly-pnl — PRD v7 §9.6.2 job 3 (AT-206).
// The scheduled run is Monday 06:00 SAST and reports the week that has just
// ended; `?catchup=1` is the startup catch-up for every complete week with no
// report. WHEN either is called belongs to the scheduler, not this route.
// Protected by CRON_SECRET header.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { catchUpWeeklyPnL, runWeeklyPnLJob } from "@/server/crons/weekly-pnl-job";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.nextUrl.searchParams.get("catchup") === "1") {
    const generated = await catchUpWeeklyPnL();
    return NextResponse.json({ ok: true, catchUp: true, generated });
  }

  const result = await runWeeklyPnLJob();
  return NextResponse.json({ ok: true, ...result });
}
