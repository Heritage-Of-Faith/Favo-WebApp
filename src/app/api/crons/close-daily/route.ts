// POST /api/crons/close-daily — task G10
// Called by Coolify's daily 23:59 SAST cron (or manually by admin).
// Protected by CRON_SECRET header. Docs: docs/API.md · BUSINESS_RULES.md L09 T01

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { closeDaily } from "@/server/crons/close-daily";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await closeDaily();
  return NextResponse.json({ ok: true, ...result });
}
