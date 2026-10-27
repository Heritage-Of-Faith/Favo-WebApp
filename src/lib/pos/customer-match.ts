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

/** A phone query is digits plus the usual separators only, with at least 3 digits. */
export function isPhoneQuery(input: string): boolean {
  return /^[\s+\-()\d]+$/.test(input.trim()) && input.replace(/\D/g, "").length >= 3;
}

/** Name tokens: any word order, comma and space tolerant. "Dlamini, Louis" -> ["dlamini","louis"]. */
export function nameTokens(input: string): string[] {
  return input.toLowerCase().split(/[\s,]+/).filter(Boolean);
}

export type SearchPlan =
  | { kind: "phone"; localPrefix: string; last4: string | null }
  | { kind: "name"; tokens: string[] }
  | { kind: "none" };

export function planSearch(query: string): SearchPlan {
  const q = query.trim();
  if (isPhoneQuery(q)) {
    const raw = q.replace(/\D/g, "");
    return { kind: "phone", localPrefix: normalisePhoneDigits(q), last4: raw.length === 4 ? raw : null };
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
    return stored.startsWith(plan.localPrefix) || (plan.last4 !== null && stored.endsWith(plan.last4));
  }
  const hay = `${c.name} ${c.surname ?? ""}`.toLowerCase();
  return plan.tokens.every((t) => hay.includes(t));
}
