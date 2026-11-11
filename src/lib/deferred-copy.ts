// Deferred-mode copy, verbatim from PRD v7.0 §6.0.4 T3 "Who | When | What they
// see". Pure and client-safe.

/** Barista, entering deferred mode: "A persistent banner … It does not go away and cannot be dismissed". */
export const DEFERRED_BANNER = "Card machine unavailable — orders are being taken unpaid.";

/** Barista, every order while deferred: "The tender step is replaced, not skipped". */
export const DEFERRED_ORDER_NOTICE = "This order is unpaid — settle it when the machine is back.";
