// GET /api/admin/unpaid-orders — admin only (PRD v7.0 §11.3 matrix row
// "GET /api/admin/unpaid-orders · /api/admin/audit-coverage · /admin/write-downs":
// admin ✔ only). §11.2: "Every unpaid order — yoco_deferred, plus any yoco
// order with no successful payment (S3a) — with its daily_seq, age and value";
// §6.7 / REQ-166: a fund-paid order is settled and never listed.
//
// The PRD gives no JSON shape, so this answers `200 {orders:[...]}` with the
// three facts it names (orderRef standing in for daily_seq, which does not
// exist yet; ageMinutes; valueZar in integer cents), oldest first. Read only:
// nothing here writes. No session → 401, non-admin → 403.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { readUnpaidOrders } from "@/server/deferred/unpaid";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  const auth = await authorize("admin");
  if (!auth.ok) {
    const status = auth.code === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: auth.message }, { status });
  }
  return NextResponse.json({ orders: await readUnpaidOrders(db, new Date()) });
}
