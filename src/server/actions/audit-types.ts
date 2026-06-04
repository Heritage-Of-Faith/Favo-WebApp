// Shared types and constants for the audit log server action.
// Kept separate from audit.ts so "use server" can export async functions only.

import { z } from "zod";
import type { AuditLog } from "@/lib/types";

export const PAGE_SIZE = 50;

export const listAuditSchema = z.object({
  page: z.number().int().nonnegative().default(0),
  entityKind: z.string().optional(),
  actorRole: z.string().optional(),
  dateFrom: z.string().optional(), // YYYY-MM-DD
  dateTo: z.string().optional(),   // YYYY-MM-DD
});

export type ListAuditInput = z.infer<typeof listAuditSchema>;

export type ListAuditResult = {
  rows: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
};
