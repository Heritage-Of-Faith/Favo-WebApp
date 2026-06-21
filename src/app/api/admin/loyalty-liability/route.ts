// GET /api/admin/loyalty-liability — CSV export of loyalty liability report (AT-127)
// Auth: admin only. Returns CSV with one row per active customer sorted by points DESC.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import { getLoyaltyLiabilityReport } from "@/server/actions/loyalty";

export async function GET() {
  const session = await getSession();
  if (!session || !canAccessAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const result = await getLoyaltyLiabilityReport();
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }

  const { allActive } = result.data;

  const header = "customer_id,name,phone,loyalty_points,liability_zar_cents,last_activity\r\n";

  const rows = allActive.map((r) => {
    const lastActivity = r.lastActivityAt ? r.lastActivityAt.toISOString() : "";
    return [
      csvEscape(r.customerId),
      csvEscape(r.name),
      csvEscape(r.phone ?? ""),
      r.loyaltyPoints,
      r.liabilityZar,
      csvEscape(lastActivity),
    ].join(",");
  });

  const csv = header + rows.join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="loyalty-liability.csv"',
    },
  });
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
