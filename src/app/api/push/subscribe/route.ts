// TODO (G7): Store PushSubscription on customer record
// Auth: any authenticated user. Docs: docs/API.md → POST /api/push/subscribe

import { NextResponse } from "next/server";

export async function POST(_request: Request) {
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
