"use server";

import type { ActionResult, Customer } from "@/lib/types";

// TODO (G5): ILIKE search on name + exact phone match
// Docs: docs/API.md → searchCustomer

export async function searchCustomer(
  query: string
): Promise<ActionResult<Customer[]>> {
  void query;
  throw new Error("Not implemented — see task G5");
}
