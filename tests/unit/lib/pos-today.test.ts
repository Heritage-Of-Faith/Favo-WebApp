// REQ-108 / REQ-129 / PRD §7.0.2 DAY block: processing_fee and net_settled.
// Any settled payment with fee_zar IS NULL makes both UNAVAILABLE (NULL),
// never a number; otherwise net_settled = card_gross + topups_settled − fee.
import { describe, it, expect } from "vitest";
import { feeAndNet, SETTLES_OVERNIGHT } from "@/lib/pos-today";

describe("feeAndNet", () => {
  it("one settled payment with no fee yet: fee and net are UNAVAILABLE, not R0.00", () => {
    expect(feeAndNet({ cardGrossZar: 26000, topupsSettledZar: 0, feeSumZar: 0, feeUnknownCount: 1 }))
      .toEqual({ feeZar: null, netSettledZar: null });
  });

  it("SUM skipping the NULL is not allowed to show a partial fee", () => {
    expect(feeAndNet({ cardGrossZar: 26000, topupsSettledZar: 0, feeSumZar: 75, feeUnknownCount: 1 }).feeZar).toBeNull();
  });

  it("every fee known: net = card gross + top-ups settled − fee (no tip term, DEC-17)", () => {
    expect(feeAndNet({ cardGrossZar: 26000, topupsSettledZar: 10000, feeSumZar: 750, feeUnknownCount: 0 }))
      .toEqual({ feeZar: 750, netSettledZar: 35250 });
  });

  it("a day with no orders and no payments shows zeroes (REQ-129's empty state)", () => {
    expect(feeAndNet({ cardGrossZar: 0, topupsSettledZar: 0, feeSumZar: 0, feeUnknownCount: 0 }))
      .toEqual({ feeZar: 0, netSettledZar: 0 });
  });

  it("the UNAVAILABLE line reads 'settles overnight' (§7.5)", () => {
    expect(SETTLES_OVERNIGHT).toBe("settles overnight");
  });
});
