// The Favo — shared contract (AT-142).
//
// ONE schema, used by BOTH entry points: the customer PWA loyalty page (AT-143)
// and the barista POS panel (AT-144) call the same server actions in
// src/server/actions/favo.ts validated against this file. Do not fork this
// shape per surface — that's the drift the AT-142 architecture mandate exists
// to prevent (see docs/POS_REBUILD_PHASE3_STRATEGY.md, "Favo drift prevention").
//
// A FavoItem is intentionally the exact shape of CreateOrderInput["items"][n]
// so one-tap reorder is literally `createOrder({ customerId, items })` with no
// mapping layer. `modifications` are menu_customisations ids; quantity-based
// customisations (AT-145, e.g. Extra Shot ×2) appear once per unit, matching
// how the POS builds orders today.

import { z } from "zod";

export const FAVO_MAX_LINES = 10;
export const FAVO_MAX_LINE_QTY = 9;

export const favoItemSchema = z.object({
  menuItemId: z.string().min(1),
  quantity: z.number().int().min(1).max(FAVO_MAX_LINE_QTY),
  modifications: z.array(z.string().min(1)).max(20),
});

export const favoItemsSchema = z
  .array(favoItemSchema)
  .min(1, "A Favo needs at least one item.")
  .max(FAVO_MAX_LINES);

export type FavoItem = z.infer<typeof favoItemSchema>;

/** What both UIs render: the template plus when/how it was last changed. */
export type FavoView = {
  items: FavoItem[];
  updatedAt: string; // ISO — serialisable across the server-action boundary
  updatedByStaffId: string | null; // null = the customer set it themselves
};
