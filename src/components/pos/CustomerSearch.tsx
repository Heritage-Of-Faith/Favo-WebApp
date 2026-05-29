// Customer search + select — owner: Mine (task M2)

import type { Customer } from "@/lib/types";

export type Props = {
  onSelect: (customer: Customer | null) => void;
};

// TODO (M2): debounced search calling searchCustomer action
export default function CustomerSearch(_props: Props) {
  return <div>CustomerSearch — task M2</div>;
}
