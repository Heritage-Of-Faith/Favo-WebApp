// TODO (G6): Yoco webhook handler
// Verify HMAC → update payment status → transition order if successful
// Idempotent on yoco_payment_id — docs/API.md

import { NextResponse } from "next/server";

export async function POST(_request: Request) {
  // TODO (G6): implement
  return NextResponse.json({ error: "Not implemented" }, { status: 501 });
}
