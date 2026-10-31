// R3-4: which lots the Yield report lists. A container-model lot is one whose
// item is tracked in cups (milk & beans) — it counts as soon as it is open or
// closed, whether or not a real container cost was recorded. Lots of other
// items count only when they carry a real container cost. A lot with no
// container cost shows its cups made with cost/cup "—" (never a guessed cost).

import { and, eq, isNotNull, or, inArray, type SQL } from "drizzle-orm";
import { inventoryItems, inventoryLots } from "@db/schema";

export function yieldLotFilter(): SQL {
  return and(
    or(eq(inventoryItems.unit, "cup"), isNotNull(inventoryLots.containerCostZar)),
    inArray(inventoryLots.state, ["open", "closed"])
  ) as SQL;
}
