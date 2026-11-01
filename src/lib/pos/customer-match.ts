// POS customer lookup — pure matching rules, shared by the server action (which
// turns the plan into SQL) and its tests. UI/search only: no money, no contract
// change. REQ-142: this module never sees or returns email.

/**
 * Digits of a phone-like string, with a South African international prefix
 * (+27 / 27 / 0027) folded back to the local leading 0.
 * "+27 82 123 4567" -> "0821234567".
 */
export function normalisePhoneDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  let rest: string;
  if (digits.startsWith("0027")) rest = digits.slice(4);
  else if (digits.startsWith("27")) rest = digits.slice(2);
  else return digits;
  return rest.startsWith("0") ? rest : `0${rest}`;
}

/** A phone-looking query: digits plus the usual separators only. */
export function isPhoneQuery(input: string): boolean {
  return /^[\s+\-()\d]+$/.test(input.trim()) && /\d/.test(input);
}

/** Name tokens: any word order, comma and space tolerant. "Dlamini, Louis" -> ["dlamini","louis"]. */
export function nameTokens(input: string): string[] {
  return input.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

export type SearchPlan =
  // Privacy: a phone query is the FULL normalised number, or EXACTLY the last 4 digits.
  // Never a prefix/suffix/partial: those would let a barista rebuild a number digit by digit.
  | { kind: "phone"; full: string | null; last4: string | null }
  | { kind: "name"; tokens: string[] }
  | { kind: "none" };

export function planSearch(query: string): SearchPlan {
  const q = query.trim();
  if (isPhoneQuery(q)) {
    const raw = q.replace(/\D/g, "");
    if (raw.length < 4) return { kind: "none" };
    return raw.length === 4
      ? { kind: "phone", full: null, last4: raw }
      : { kind: "phone", full: normalisePhoneDigits(q), last4: null };
  }
  const tokens = nameTokens(q);
  return tokens.length ? { kind: "name", tokens } : { kind: "none" };
}

type Candidate = { name: string; surname?: string | null; phone?: string | null };

/** In-memory form of the plan: the spec the SQL in searchCustomer mirrors. */
export function customerMatches(c: Candidate, query: string): boolean {
  const plan = planSearch(query);
  if (plan.kind === "none") return false;
  if (plan.kind === "phone") {
    const stored = normalisePhoneDigits(c.phone ?? "");
    if (!stored) return false;
    return plan.full !== null ? stored === plan.full : stored.endsWith(plan.last4 ?? "\u0000");
  }
  const hay = `${c.name} ${c.surname ?? ""}`.toLowerCase();
  return plan.tokens.every((t) => hay.includes(t));
}
