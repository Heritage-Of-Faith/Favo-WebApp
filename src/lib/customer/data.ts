// Customer-data access — G18/G19 real Server Actions now live.
//
// 👉 SINGLE SWAP-IN POINT. The customer PWA imports its data ONLY from here.
//
// Real implementation is in @/server/actions/customer. The mock in ./mock.ts
// is kept for reference but is no longer used — safe to delete after QA.

export {
  getCustomerSummary,
  listCustomerOrders,
  getPacks,
  updateCustomerProfile,
} from "@/server/actions/customer";

export type {
  CustomerSummary,
  CustomerOrder,
  PacksView,
  CoffeePack,
  CustomerProfileInput,
} from "./contract";
