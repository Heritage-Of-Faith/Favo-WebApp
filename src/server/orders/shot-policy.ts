// AT-202 part 1: read the shot policy in force for a revenue day — today's
// opening_sessions.mode values and the three app_config shot settings (T09,
// T15) — and which recipes hold coffee. Server only. The arithmetic is in
// ./shot-surcharge.ts.

import { and, eq, inArray } from "drizzle-orm";
import { appConfig, inventoryItems, openingSessions, recipeIngredients } from "@db/schema";
import type { DB } from "@/lib/db";
import {
  COFFEE_KIND,
  parseShotConfigWithFallbacks,
  resolveShotPolicy,
  SHOT_CONFIG_KEYS,
  type ShotPolicy,
} from "@/server/orders/shot-surcharge";

/** The single tenant (db/schema.ts tenantId() default). */
const TENANT = "hofmi";

export type ShotPolicyRead = ShotPolicy & {
  /** app_config keys whose stored value was malformed and replaced by the PRD default (or clamped). */
  configFallbacks: string[];
};

/**
 * The policy for `day` (YYYY-MM-DD, the SAST revenue day). Mode is resolved
 * the way the free cup resolves it (createOrder's readFreeCupContext): every
 * opening_sessions row for the day.
 */
export async function readShotPolicy(client: Pick<DB, "select">, day: string): Promise<ShotPolicyRead> {
  const [sessionRows, configRows] = await Promise.all([
    client.select({ mode: openingSessions.mode }).from(openingSessions).where(eq(openingSessions.sessionDate, day)),
    client
      .select({ key: appConfig.key, value: appConfig.value })
      .from(appConfig)
      .where(and(eq(appConfig.tenantId, TENANT), inArray(appConfig.key, Object.values(SHOT_CONFIG_KEYS)))),
  ]);
  const { config, fallbacks } = parseShotConfigWithFallbacks(configRows);
  return {
    ...resolveShotPolicy(sessionRows.map((r) => r.mode), config),
    configFallbacks: fallbacks,
  };
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
