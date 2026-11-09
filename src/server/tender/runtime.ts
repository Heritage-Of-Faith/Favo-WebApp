// AT-201 part 2b: the production collaborators of the tender chain.
//
//   store       Postgres (./drizzle-store.ts)
//   port        the Web POS port. By default the port reports that no Web
//               POS device is linked: every send is TERMINAL_UNREACHABLE (S1:
//               "No Web POS device is linked") and every fetch is a fetch
//               error, which is never a status (§6.8.4). Nothing is charged.
//               The live HTTP adapter (@/server/yoco/webpos-http) is selected
//               ONLY when YOCO_WEBPOS_LIVE=1 and YOCO_SECRET_KEY are both set
//               — it is proven at gate zero (§6.8.2's R1.00 test) first.
//   readDeviceId  app_config.webpos_device_id (§10.4), read once per tender
//   notify      the Admin pushes (./admin-notifier.ts)
//
// Tests replace this module; they run the chain on an in-memory store and
// FakeYocoWebPosPort.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig, openingSessions } from "@db/schema";
import { revenueDay } from "@/lib/format";
import { createDrizzleTenderStore } from "./drizzle-store";
import { unlinkedWebPosPort } from "./unlinked-port";
import { createYocoWebPosPort } from "@/server/yoco/webpos-http";
import type { YocoWebPosPort } from "@/server/yoco/webpos-port";
import { createAdminTenderNotifier } from "./admin-notifier";
import type { TenderDeps } from "./types";

export const WEBPOS_DEVICE_KEY = "webpos_device_id";

export { unlinkedWebPosPort };

/** The single tenant (db/schema.ts tenantId() default). */
const TENANT = "hofmi";

/** §10.4: the configured machine, keyed (tenant_id, key). A non-string or absent value is "not configured". */
export async function readWebPosDeviceId(): Promise<string | null> {
  const [row] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.tenantId, TENANT), eq(appConfig.key, WEBPOS_DEVICE_KEY)))
    .limit(1);
  return typeof row?.value === "string" ? row.value : null;
}

/** S1 NO_SESSION: "No opening_sessions row for today" (the SAST revenue day). */
export async function hasSessionToday(now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: openingSessions.id })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, revenueDay(now)))
    .limit(1);
  return rows.length > 0;
}

/**
 * The live adapter only on an explicit switch AND a key; anything else is the
 * unlinked port, exactly as before. The key itself is read by the adapter at
 * call time, never here.
 *
 * WARNING: turning on YOCO_WEBPOS_LIVE also turns on CARD TOP-UPS for the
 * blessing fund — src/server/funds/runtime.ts takes its port from
 * getTenderDeps(). Drill both before switching it on.
 */
export function selectWebPosPort(env: Record<string, string | undefined> = process.env): YocoWebPosPort {
  if (env.YOCO_WEBPOS_LIVE === "1" && !!env.YOCO_SECRET_KEY) return createYocoWebPosPort();
  return unlinkedWebPosPort;
}

export function getTenderDeps(): TenderDeps {
  const now = () => new Date();
  return {
    store: createDrizzleTenderStore(db),
    port: selectWebPosPort(),
    now,
    readDeviceId: readWebPosDeviceId,
    notify: createAdminTenderNotifier(now),
  };
}
