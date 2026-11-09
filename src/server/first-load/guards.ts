// First load of an empty production database — go-live gap G3
// (docs/GO_LIVE_RUNBOOK.md §8, PRD v7 §13.0: FAVO starts on a clean database).
//
// The pure core of scripts/first-load.ts: the refusals and the order of work.
// The database is reached only through the injected deps, so this is unit
// tested with fakes (tests/unit/server/deploy/first-load.test.ts).
//
// Safe to re-run until the first order: every step is idempotent (stable ids +
// ON CONFLICT DO NOTHING, or a skipIf check), so a run that failed partway is
// finished by running it again. Once `orders` has a row, trading has started
// and it refuses (seedRecipes re-sets menu_items.recipe_id unconditionally).
//
// The first admin's PIN is never logged, echoed or put in a message.

export const FIRST_ADMIN_PIN_ENV = "FIRST_ADMIN_PIN";
export const FIRST_ADMIN_ID = "staff_admin_first";
export const FIRST_ADMIN_NAME = "Admin";

/** Guessable PINs, including the dev seed's (db/seed/staff.ts). */
export const REFUSED_PINS: readonly string[] = ["1234", "2345", "4321", "1111", "0000", "123456"];

const PIN_SHAPE = /^\d{4,6}$/;

export type PinCheck = { ok: true; pin: string } | { ok: false; reason: string };

export function checkFirstAdminPin(pin: string | undefined): PinCheck {
  if (pin === undefined) return { ok: false, reason: `${FIRST_ADMIN_PIN_ENV} is not set.` };
  if (!PIN_SHAPE.test(pin)) {
    return { ok: false, reason: `${FIRST_ADMIN_PIN_ENV} must be 4 to 6 digits and nothing else.` };
  }
  if (REFUSED_PINS.includes(pin)) {
    return { ok: false, reason: `${FIRST_ADMIN_PIN_ENV} is a well-known PIN. Choose another.` };
  }
  if (/^(\d)\1+$/.test(pin)) {
    return { ok: false, reason: `${FIRST_ADMIN_PIN_ENV} is one digit repeated. Choose another.` };
  }
  return { ok: true, pin };
}

export function missingDatabaseUrl(env: Record<string, string | undefined>): boolean {
  return !env.DATABASE_URL?.trim();
}

export interface FirstLoadStep {
  name: string;
  run: () => Promise<void>;
  /** For a step that is not idempotent on its own: true = already loaded, skip. */
  skipIf?: () => Promise<boolean>;
}

export interface FirstAdminRow {
  id: string;
  name: string;
  role: "admin";
  pinHash: string;
  active: true;
}

export interface StaffSummary {
  name: string;
  role: string;
}

export interface FirstLoadDeps {
  countOrders: () => Promise<number>;
  /** Names and roles only, never PIN hashes. */
  listStaff: () => Promise<StaffSummary[]>;
  /** Run in this order. */
  steps: FirstLoadStep[];
  hashPin: (pin: string) => Promise<string>;
  insertAdmin: (row: FirstAdminRow) => Promise<void>;
}

export type FirstLoadOutcome =
  | { ok: true; ran: string[]; skipped: string[]; adminCreated: boolean; existingStaff: StaffSummary[] }
  | { ok: false; code: "ORDERS_EXIST" | "BAD_PIN"; message: string };

/**
 * Refuses once trading has started (`orders` has rows), and refuses a bad
 * first-admin PIN, before anything is written. Then runs the steps in order and,
 * only if `staff` is empty, creates exactly one active admin.
 */
export async function runFirstLoad(
  env: Record<string, string | undefined>,
  deps: FirstLoadDeps,
): Promise<FirstLoadOutcome> {
  const orderRows = await deps.countOrders();
  if (orderRows > 0) {
    return {
      ok: false,
      code: "ORDERS_EXIST",
      message: `orders already has ${orderRows} row(s): trading has started, so first load no longer runs. Nothing was written.`,
    };
  }

  const existingStaff = await deps.listStaff();
  let pinHash: string | null = null;
  if (existingStaff.length === 0) {
    const pin = checkFirstAdminPin(env[FIRST_ADMIN_PIN_ENV]);
    if (!pin.ok) return { ok: false, code: "BAD_PIN", message: `${pin.reason} Nothing was written.` };
    pinHash = await deps.hashPin(pin.pin);
  }

  const ran: string[] = [];
  const skipped: string[] = [];
  for (const step of deps.steps) {
    if (step.skipIf && (await step.skipIf())) {
      skipped.push(step.name);
      continue;
    }
    await step.run();
    ran.push(step.name);
  }

  if (pinHash !== null) {
    await deps.insertAdmin({
      id: FIRST_ADMIN_ID,
      name: FIRST_ADMIN_NAME,
      role: "admin",
      pinHash,
      active: true,
    });
  }

  return { ok: true, ran, skipped, adminCreated: pinHash !== null, existingStaff };
}
