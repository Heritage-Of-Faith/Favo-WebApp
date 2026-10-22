// AT-211 — the one schema for a customer's surname + status.
//
// PRD §10.3: customers.status (office_staff | church_member) is "Set at
// self-registration" — registerCustomer only; the account page cannot change it.
// §6.4's drift rule: surname is validated by this same schema on the sign-up
// form (registerCustomer) and the account page (updateCustomerProfile).
//
// The values mirror db/enums.ts `customerStatus` (a test asserts they match);
// they are repeated here so the client form needs no Drizzle import.

import { z } from "zod";

export const CUSTOMER_STATUSES = ["office_staff", "church_member"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** Control (Cc) and format (Cf, incl. zero-width and bidi) characters. */
const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;

/** A blank string means "no surname" — null, which clears it on the account page. */
const blankToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

export const surnameSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(100, "Surname must be 100 characters or fewer.")
    .refine((s) => !INVISIBLE_OR_CONTROL.test(s), "Surname contains characters that aren't allowed.")
    .nullable()
    .optional(),
);

export const customerIdentitySchema = z.object({
  surname: surnameSchema,
  // Required: a missing status is refused, never silently defaulted to church_member.
  status: z.enum(CUSTOMER_STATUSES, { message: "Please choose office staff or church member." }),
});
