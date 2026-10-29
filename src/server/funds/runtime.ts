// AT-203: the production collaborators of the blessing-fund rules.
//
//   store       Postgres (./drizzle-store.ts)
//   readConfig  T13 donor_fund_ceiling_zar and T14 donor_fund_dormancy_days
//               from app_config (§10.4), with the PRD's defaults (R2,000 and
//               180 days) when a key is absent. A stored value that is not a
//               positive whole number is NOT replaced by the default — the
//               fund refuses (VALIDATION) until an Admin fixes it.
//   randomCode  `FVO-` + 4 symbols from the 31-symbol alphabet, uniformly
//               (rejection sampling), from crypto.getRandomValues.
//   notify      R22's immediate Admin push on an unnamed fund (§9.6.3 copy).
//   tender      the tender chain's port, device id and S4a/REQ-011 pushes for
//               a card top-up — the same port the order chain uses.
//
// Tests replace this module; the rules run on an in-memory store.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig, donorFundEntries, donorFunds, staff } from "@db/schema";
import { formatZar } from "@/lib/format";
import { alertAdmins } from "@/server/push/admin-alert";
import { S4A_ACTION } from "@/server/tender/admin-notifier";
import { getTenderDeps } from "@/server/tender/runtime";
import { createDrizzleFundTopupStore } from "@/server/tender/drizzle-store";
import type { TenderDeps, TenderNotifier } from "@/server/tender/types";
import { createDrizzleFundStore } from "./drizzle-store";
import { FUND_CODE_ALPHABET } from "./funds";
import { DEFAULT_FUND_CONFIG, type FundConfig, type FundDeps, type FundNotifier } from "./types";

const TENANT = "hofmi";
export const FUND_CEILING_KEY = "donor_fund_ceiling_zar";
export const FUND_DORMANCY_KEY = "donor_fund_dormancy_days";

function positiveWhole(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/** T13 / T14 (§10.4). Absent → the PRD default; present but invalid → null (refuse). */
export async function readFundConfig(): Promise<FundConfig | null> {
  const rows = await db
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.tenantId, TENANT), inArray(appConfig.key, [FUND_CEILING_KEY, FUND_DORMANCY_KEY])));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const ceiling = byKey.has(FUND_CEILING_KEY) ? positiveWhole(byKey.get(FUND_CEILING_KEY)) : DEFAULT_FUND_CONFIG.ceilingZar;
  const dormancy = byKey.has(FUND_DORMANCY_KEY) ? positiveWhole(byKey.get(FUND_DORMANCY_KEY)) : DEFAULT_FUND_CONFIG.dormancyDays;
  return ceiling === null || dormancy === null ? null : { ceilingZar: ceiling, dormancyDays: dormancy };
}

/** §6.10.3: `FVO-7K2M`. Uniform over the 31 symbols. */
export function randomFundCode(): string {
  const n = FUND_CODE_ALPHABET.length; // 31
  const limit = 256 - (256 % n); // reject bytes ≥ 248 so every symbol is equally likely
  let out = "";
  while (out.length < 4) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < 4) out += FUND_CODE_ALPHABET[b % n];
    }
  }
  return `FVO-${out}`;
}

/** §9.6.3, verbatim: "A fund was opened with no name — [barista], [amount], [code]." */
export function unnamedFundAlert(baristaName: string, amountZar: number, code: string) {
  return {
    title: "Unnamed blessing fund opened",
    body: `A fund was opened with no name — ${baristaName}, ${formatZar(amountZar)}, ${code}.`,
  };
}

export function createAdminFundNotifier(): FundNotifier {
  return {
    async unnamedFundCreated(info) {
      const [s] = await db.select({ name: staff.name }).from(staff).where(eq(staff.id, info.staffId));
      const a = unnamedFundAlert(s?.name ?? "unknown barista", info.amountZar, info.code);
      await alertAdmins(a.title, a.body, { fundId: info.fundId, code: info.code, staffId: info.staffId, amountZar: info.amountZar });
    },
  };
}

async function fundCodeOfTopup(entryId: string): Promise<string> {
  const [r] = await db
    .select({ code: donorFunds.code })
    .from(donorFundEntries)
    .innerJoin(donorFunds, eq(donorFundEntries.fundId, donorFunds.id))
    .where(eq(donorFundEntries.id, entryId));
  return r?.code ?? entryId.slice(0, 8);
}

/** S4a / REQ-011 for a top-up: the chain's pushes, naming the fund instead of an order. */
export function createAdminTopupNotifier(): TenderNotifier {
  return {
    async paymentUnresolved(info) {
      const code = await fundCodeOfTopup(info.orderId);
      await alertAdmins(
        `Payment unresolved — fund top-up ${code}`,
        `${formatZar(info.amountZar)} · attempt ${info.attempt}. ${S4A_ACTION}`,
        { fundTopupId: info.orderId, attempt: info.attempt, amountZar: info.amountZar, cause: info.cause }
      );
    },
    async duplicateCharge(info) {
      const code = await fundCodeOfTopup(info.orderId);
      await alertAdmins(
        `Duplicate charge — fund top-up ${code}`,
        `Charged twice: Yoco ${info.yocoPaymentIds.join(" and ")} · ${formatZar(info.amountZar)}.`,
        { fundTopupId: info.orderId, yocoPaymentIds: info.yocoPaymentIds, amountZar: info.amountZar }
      );
    },
  };
}

/** The tender chain's deps for top-ups: same port and device id, the fund-top-up store. */
export function getTopupTenderDeps(): TenderDeps {
  const base = getTenderDeps();
  return { ...base, store: createDrizzleFundTopupStore(db), notify: createAdminTopupNotifier() };
}

export function getFundDeps(): FundDeps {
  const tender = getTopupTenderDeps();
  return {
    store: createDrizzleFundStore(db),
    now: () => new Date(),
    readConfig: readFundConfig,
    randomCode: randomFundCode,
    newClientUuid: () => crypto.randomUUID(),
    notify: createAdminFundNotifier(),
    tender: { port: tender.port, readDeviceId: tender.readDeviceId, notify: tender.notify },
  };
}
