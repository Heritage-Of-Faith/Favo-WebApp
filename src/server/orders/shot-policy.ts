// AT-202 part 1: read the shot policy in force for a revenue day — today's
// opening_sessions.mode values and the three app_config shot settings (T09,
// T15) — and which recipes hold coffee. Server only. The arithmetic is in
// ./shot-surcharge.ts.
//
// Event switches: the mode is read at an instant (src/lib/till-mode.ts), so an
// event in force brings its own extra-shot switch (inert under a free posture)
// and the event's name, posture and menu scope for the POS to draw.

import { and, eq, inArray } from "drizzle-orm";
import { appConfig, inventoryItems, recipeIngredients } from "@db/schema";
import type { DB } from "@/lib/db";
import {
  COFFEE_KIND,
  eventShotPolicy,
  parseShotConfigWithFallbacks,
  resolveShotPolicy,
  SHOT_CONFIG_KEYS,
  type ShotPolicy,
} from "@/server/orders/shot-surcharge";
import { readTillMode } from "@/server/orders/till-mode-read";
import { eventSurchargeInForce, tillEventView, type TillEventView } from "@/lib/till-mode";

/** The single tenant (db/schema.ts tenantId() default). */
const TENANT = "hofmi";

export type ShotPolicyRead = ShotPolicy & {
  /** app_config keys whose stored value was malformed and replaced by the PRD default (or clamped). */
  configFallbacks: string[];
  /** The event in force at the instant read, or null (§6.6). */
  event: TillEventView | null;
};

/**
 * The policy for `day` (YYYY-MM-DD, the SAST revenue day) at instant `at`
 * (default now). Mode is resolved the way the free cup resolves it
 * (createOrder's readFreeCupContext): every opening_sessions row for the day,
 * each read as it behaves at `at`; an event in force replaces them.
 */
export async function readShotPolicy(
  client: Pick<DB, "select">, day: string, at: Date = new Date()
): Promise<ShotPolicyRead> {
  const [till, configRows] = await Promise.all([
    readTillMode(client, day, at),
    client
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.tenantId, TENANT), inArray(appConfig.key, Object.values(SHOT_CONFIG_KEYS)))),
  ]);
  const { config, fallbacks } = parseShotConfigWithFallbacks(configRows);
  const policy = till.event
    ? eventShotPolicy(eventSurchargeInForce(till.event), config)
    : resolveShotPolicy(till.modes, config);
  return { ...policy, configFallbacks: fallbacks, event: tillEventView(till.event) };
}

/**
 * Of `recipeIds`, the ones whose recipe holds coffee — an ingredient of
 * inventory kind 'bean', the kind getMenu's `takesShots` keys on (L48).
 */
export async function readCoffeeRecipeIds(client: Pick<DB, "selectDistinct">, recipeIds: string[]): Promise<Set<string>> {
  if (recipeIds.length === 0) return new Set();
  const rows = await client
    .selectDistinct({ recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .innerJoin(inventoryItems, eq(recipeIngredients.inventoryItemId, inventoryItems.id))
    .where(and(inArray(recipeIngredients.recipeId, recipeIds), eq(inventoryItems.kind, COFFEE_KIND)));
  return new Set(rows.map((r) => r.recipeId));
}
