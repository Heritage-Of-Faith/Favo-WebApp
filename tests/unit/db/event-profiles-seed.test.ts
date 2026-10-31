// AT-204 prerequisite (Migration A): the two seeded event profiles carry the
// PRD's literal switch values. Sources, docs/FAVO_PRD_v7.md:
//   §6.6 "The Discipleship 101 profile": menu = coffee-only · payment = free ·
//     cups = consumed · audience = church member · extra-shot surcharge = not
//     charged · voucher kinds = none; Path A: every Wednesday, 18:30–20:30.
//   §6.11.2 Untracked Church: Full · `standard` · Consumed · Office staff +
//     church members · Charged · `["untracked_hot_drink"]`.

import { describe, it, expect } from "vitest";
import { EVENT_PROFILES_SEED } from "@db/seed/event-profiles";

const byName = (name: string) => EVENT_PROFILES_SEED.find((p) => p.name === name);

describe("seed: event profiles (PRD §6.6, §6.11.2)", () => {
  it("seeds exactly the two PRD profiles, with unique ids", () => {
    expect(EVENT_PROFILES_SEED.map((p) => p.name).sort()).toEqual([
      "Discipleship 101",
      "Untracked Church",
    ]);
    const ids = EVENT_PROFILES_SEED.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Discipleship 101: recurring Wednesday 18:30–20:30, free, coffee-only, disposables, church members, no surcharge, no vouchers", () => {
    expect(byName("Discipleship 101")).toMatchObject({
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
    });
  });

  it("Untracked Church: recurring Sunday, full menu, standard prices, disposables, both audiences, surcharge charged, untracked_hot_drink live", () => {
    expect(byName("Untracked Church")).toMatchObject({
      recurrence: "FREQ=WEEKLY;BYDAY=SU",
      menuScope: "full",
      paymentPosture: "standard",
      consumesCupLid: true,
      audience: "both",
      extraShotSurcharge: true,
      voucherKinds: ["untracked_hot_drink"],
      active: true,
    });
  });

  it("Untracked Church carries no default window: the PRD does not state one", () => {
    const p = byName("Untracked Church");
    expect(p?.defaultStart).toBeNull();
    expect(p?.defaultEnd).toBeNull();
  });
});
