// Event profile seed — AT-204 prerequisite (Migration A).
// The two §6.6 Path A recurring profiles named in docs/FAVO_PRD_v7.md:
//   Discipleship 101 — §6.6 worked example: every Wednesday, 18:30–20:30,
//     coffee-only · free · cups consumed · church member · no surcharge ·
//     no voucher kinds.
//   Untracked Church — §6.11.2: Sunday evening service, full · standard ·
//     cups consumed · office staff + church members · surcharge charged ·
//     voucher kinds ["untracked_hot_drink"].
// The PRD gives Untracked Church no window times, so default_start and
// default_end stay NULL until the owner sets them (open question, AT-204).
// recurrence is an RFC 5545 RRULE; NULL would mean one-off (§10.2).

import { db } from "../index";
import { eventProfiles } from "../schema";

export type SeedEventProfile = typeof eventProfiles.$inferInsert & {
  id: string;
  name: string;
  recurrence: string | null;
  defaultStart: string | null;
  defaultEnd: string | null;
  voucherKinds: string[];
  active: boolean;
};

export const EVENT_PROFILES_SEED: SeedEventProfile[] = [
  {
    id: "evp_discipleship_101",
    name: "Discipleship 101",
    recurrence: "FREQ=WEEKLY;BYDAY=WE",
    defaultStart: "18:30",
    defaultEnd: "20:30",
    menuScope: "coffee_only",
    paymentPosture: "free",
    consumesCupLid: true,
    audience: "church_member",
    extraShotSurcharge: false,
    voucherKinds: [],
    active: true,
  },
  {
    id: "evp_untracked_church",
    name: "Untracked Church",
    recurrence: "FREQ=WEEKLY;BYDAY=SU",
    defaultStart: null,
    defaultEnd: null,
    menuScope: "full",
    paymentPosture: "standard",
    consumesCupLid: true,
    audience: "both",
    extraShotSurcharge: true,
    voucherKinds: ["untracked_hot_drink"],
    active: true,
  },
];

export async function seedEventProfiles() {
  console.log(`  → event profiles (${EVENT_PROFILES_SEED.length})`);
  await db.insert(eventProfiles).values(EVENT_PROFILES_SEED).onConflictDoNothing();
}
