// Customer-data access — owner: Nikao (Phase 3 integration seam).
//
// 👉 SINGLE SWAP-IN POINT. The customer PWA imports its data ONLY from here.
//
// Today these re-export the TEMPORARY mock (`./mock`) because Gian's Phase 3
// backend isn't on `main` yet. When the real Server Actions land, change the two
// re-export lines below to point at his module, e.g.:
//
//     export {
//       getCustomerSummary,
//       listCustomerOrders,
//       getWallet,
//       getPacks,
//       updateCustomerProfile,
//     } from "@/server/actions/customer";
//
// …then delete `./mock.ts`. No page/component code changes — they all depend on
// the stable contract types below.

export {
  getCustomerSummary,
  listCustomerOrders,
  getWallet,
  getPacks,
  updateCustomerProfile,
} from "./mock";

export type {
  CustomerSummary,
  CustomerOrder,
  WalletView,
  WalletTransaction,
  WalletTransactionKind,
  PacksView,
  CoffeePack,
  CustomerProfileInput,
  CustomerDataApi,
} from "./contract";
