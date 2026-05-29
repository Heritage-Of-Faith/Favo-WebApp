// Active order detail + Done button — owner: Mine (task M6)
// Rule L15: Done button must be the most visually dominant action on screen.

import type { Order } from "@/lib/types";

export type Props = { order: Order };

// TODO (M6): show order items, totals, Done CTA → transitionOrder('ready')
export default function ActiveOrder(_props: Props) {
  return <div>ActiveOrder — task M6</div>;
}
