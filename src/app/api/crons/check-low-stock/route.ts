// POST /api/crons/check-low-stock — task G14
// Called by Coolify's 15-minute cron (or manually by admin).
// Protected by CRON_SECRET header to prevent unauthenticated invocation.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkLowStock } from "@/server/crons/check-low-stock";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await checkLowStock();
  return NextResponse.json({ ok: true, ...result });
}
