// Admin sidebar nav — owner: Mia (task A2)
// Collapsible below 1024px. Finance role hides "Menu" and "Staff" items.
// Docs: docs/DESIGN.md → Admin Rules

import type { StaffRole } from "@/lib/types";

export type Props = { role: StaffRole };

// TODO (A2): implement sidebar with role-based nav items
export default function Sidebar(_props: Props) {
  return <nav>Sidebar — task A2</nav>;
}
