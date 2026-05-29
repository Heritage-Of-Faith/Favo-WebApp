"use server";

import type { ActionResult } from "@/lib/types";
import { writeAudit } from "@/server/audit";

// TODO (G4): implement PIN login — query staff table, bcrypt.compare(pin, pin_hash)
// Docs: docs/API.md → loginWithPin

export async function loginWithPin(pin: string): Promise<ActionResult<{ staffId: string }>> {
  void pin;
  void writeAudit;
  throw new Error("Not implemented — see task G4");
}

export async function signOut(): Promise<ActionResult> {
  throw new Error("Not implemented — see task G4");
}
