// AT-202 part 1 · REQ-104 · REQ-136 · REQ-138 · REQ-144 · L31 · T09 · T15 · DEC-16.
// PRD v7.0 §7.0.2: surcharge_zar = config.extra_shot_zar × MAX(0, shots − 2),
// PER UNIT, where the surcharge is in force (every Sunday, and events whose
// extra_shot switch is set), ELSE 0. §6.2.3c / T15: a line takes 1 to
// max_shots_per_line shots (4), and at most max_shots_weekday (2) on a weekday.
//
// Pure functions, integer cents only. No database import, so the POS can use
// the same arithmetic to show the draft price; the server is the authority.

/** The DB CHECK order_items_shots_range: the outer ceiling, whatever config says. */
export const DB_MAX_SHOTS = 4;

/** app_config keys (PRD §12 config table). */
export const SHOT_CONFIG_KEYS = {
  extraShotZar: "extra_shot_zar",
  maxShotsPerLine: "max_shots_per_line",
  maxShotsWeekday: "max_shots_weekday",
} as const;

/** PRD §12 defaults: R10 (integer cents), 4 shots, 2 on a weekday (T09, T15). */
export const SHOT_CONFIG_DEFAULTS = {
  extraShotZar: 1000,
  maxShotsPerLine: 4,
  maxShotsWeekday: 2,
} as const;

/** The inventory kind that holds the coffee — a line whose recipe has none gets no picker (L48). */
export const COFFEE_KIND = "bean";

export type ShotConfig = {
  extraShotZar: number;
  maxShotsPerLine: number;
  maxShotsWeekday: number;
};

export type ShotMode = "weekday" | "sunday" | "unresolved";

export type ShotPolicy = {
  /** "unresolved" = no session today, an event, or mixed modes — fail closed. */
  mode: ShotMode;
  /** The most shots one line may carry right now (T15). */
  maxShots: number;
  /** Whether T09's surcharge applies right now (Sunday only on this base). */
  surchargeInForce: boolean;
  /** config.extra_shot_zar, integer cents. */
  extraShotZar: number;
};

/** The policy a POS falls back to when it knows nothing: weekday ceiling, no surcharge. */
export const FAIL_CLOSED_POLICY: ShotPolicy = {
  mode: "unresolved",
  maxShots: SHOT_CONFIG_DEFAULTS.maxShotsWeekday,
  surchargeInForce: false,
  extraShotZar: SHOT_CONFIG_DEFAULTS.extraShotZar,
};

/**
 * §7.0.2: the extra-shot surcharge for ONE unit of a line. One and two shots
 * carry none; the third is the first that is charged. 0 when not in force.
 */
export function shotSurchargeZar(shots: number, extraShotZar: number, inForce: boolean): number {
  if (!Number.isInteger(shots) || shots < 1) throw new RangeError(`shots must be an integer ≥ 1, got ${shots}`);
  if (!Number.isInteger(extraShotZar) || extraShotZar < 0) {
    throw new RangeError(`extraShotZar must be integer cents ≥ 0, got ${extraShotZar}`);
  }
  if (!inForce) return 0;
  return extraShotZar * Math.max(0, shots - 2);
}

/**
 * T15: the shot ceiling for a mode. A weekday takes max_shots_weekday; a
 * Sunday takes max_shots_per_line. Anything else — an event (event windows
 * and their switch are AT-202 part 2), no session, mixed modes — fails closed
 * to the weekday ceiling, so nothing above it is ever written un-priced.
 */
export function shotCeiling(mode: ShotMode | "event", config: ShotConfig): number {
  return mode === "sunday" ? config.maxShotsPerLine : config.maxShotsWeekday;
}

/**
 * Map today's opening_sessions.mode values to the policy in force.
 *  - every session `weekday` → weekday: ceiling 2, no surcharge.
 *  - every session `sunday`  → sunday: ceiling 4, surcharge in force.
 *  - none, `event`, or mixed → unresolved: weekday ceiling, no surcharge.
 *    An `event` session can be opened (AT-204), but the till does not read
 *    its extra_shot switch yet (session-mode.ts SWITCHES_IN_TILL); reading
 *    it is AT-202 part 2.
 */
export function resolveShotPolicy(modes: readonly string[], config: ShotConfig): ShotPolicy {
  let mode: ShotMode = "unresolved";
  if (modes.length > 0 && modes.every((m) => m === "weekday")) mode = "weekday";
  else if (modes.length > 0 && modes.every((m) => m === "sunday")) mode = "sunday";
  return {
    mode,
    maxShots: shotCeiling(mode, config),
    surchargeInForce: mode === "sunday",
    extraShotZar: config.extraShotZar,
  };
}

function intIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/**
 * Read the three app_config values (jsonb numbers). A missing or malformed
 * row is the PRD default. The ceilings never exceed the DB CHECK (4), and the
 * weekday ceiling never exceeds the per-line one.
 */
export function parseShotConfig(rows: readonly { key: string; value: unknown }[]): ShotConfig {
  return parseShotConfigWithFallbacks(rows).config;
}

/**
 * As parseShotConfig, and also names every key whose STORED value could not be
 * used as written — malformed (a string, a fraction, out of range) and so
 * replaced by the PRD default, or max_shots_weekday clamped to
 * max_shots_per_line. A key with no row is not listed: the default is the
 * intended value then. Lets a caller see a fallback without logging.
 */
export function parseShotConfigWithFallbacks(
  rows: readonly { key: string; value: unknown }[]
): { config: ShotConfig; fallbacks: string[] } {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const fallbacks: string[] = [];
  const read = (key: string, min: number, max: number, dflt: number): number => {
    if (!byKey.has(key)) return dflt;
    const v = intIn(byKey.get(key), min, max);
    if (v === null) fallbacks.push(key);
    return v ?? dflt;
  };
  const extraShotZar = read(SHOT_CONFIG_KEYS.extraShotZar, 0, Number.MAX_SAFE_INTEGER, SHOT_CONFIG_DEFAULTS.extraShotZar);
  const maxShotsPerLine = read(SHOT_CONFIG_KEYS.maxShotsPerLine, 1, DB_MAX_SHOTS, SHOT_CONFIG_DEFAULTS.maxShotsPerLine);
  const weekday = read(SHOT_CONFIG_KEYS.maxShotsWeekday, 1, DB_MAX_SHOTS, SHOT_CONFIG_DEFAULTS.maxShotsWeekday);
  if (weekday > maxShotsPerLine && !fallbacks.includes(SHOT_CONFIG_KEYS.maxShotsWeekday)) {
    fallbacks.push(SHOT_CONFIG_KEYS.maxShotsWeekday);
  }
  return {
    config: { extraShotZar, maxShotsPerLine, maxShotsWeekday: Math.min(weekday, maxShotsPerLine) },
    fallbacks,
  };
}

/** "1 shot" / "3 shots" — the line's configuration as the barista reads it (§6.2.4c). */
export function shotsLabel(shots: number): string {
  return shots === 1 ? "1 shot" : `${shots} shots`;
}

/** SHOTS_NOT_ALLOWED copy (L48: no coffee, no shots). Not PRD copy — the PRD names no code for it. */
export function shotsNotAllowedMessage(itemName: string): string {
  return `${itemName} has no coffee in it, so it can't take extra shots.`;
}

/** SHOTS_ABOVE_CEILING copy. Not PRD copy — the PRD names no code or words for this refusal. */
export function shotsAboveCeilingMessage(policy: ShotPolicy): string {
  if (policy.mode === "weekday") return `Weekday drinks take at most ${policy.maxShots} shots.`;
  if (policy.mode === "sunday") return `A drink takes at most ${policy.maxShots} shots.`;
  return `Open today's session first — until then a drink takes at most ${policy.maxShots} shots.`;
}
