// Risky-migration opt-in — AT-170, owner decision by Nikao, 21 Oct 2026.
//
// Ordinary migrations auto-apply on container start. A risky one — destructive
// (DROP, column type change, data delete/rewrite) or touching payments, orders
// or order_items (CLAUDE.md §2.2) — needs a human: it carries
//
//   -- favo:requires-approval <one-line reason>
//
// in its leading comment block, and the release step refuses to apply it
// unless FAVO_APPROVE_MIGRATION names that exact tag. The operator takes and
// verifies a full backup first (PRD §13.3 step 1).
//
// Shared by scripts/migrate.ts (startup) and scripts/check-migration-approval.ts
// (the CI gate that makes the marker impossible to forget).

/** The marker, on its own comment line in the file's leading comment block. */
export const APPROVAL_MARKER = "favo:requires-approval";

/** The env var an operator sets to approve named risky migrations. */
export const APPROVAL_ENV = "FAVO_APPROVE_MIGRATION";

/**
 * Journal idx from which the CI gate (and the startup pattern check) applies.
 * 0000–0033 predate the decision: they are applied in production, several are
 * destructive by design (0026, 0032), and 0033 was owner-approved on its PR.
 */
export const GATED_FROM_IDX = 34;

const RISKY_PATTERNS: { reason: string; re: RegExp }[] = [
  // DROP anything, except what loses no data: the two relaxations, and a view
  // (a stored query, no rows; owner decision, Nikao, 30 Oct 2026 — 0038).
  { reason: "DROP", re: /\bDROP\b(?!\s+(DEFAULT|NOT\s+NULL|VIEW)\b)/i },
  { reason: "column type change", re: /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i },
  { reason: "data delete (DELETE)", re: /\bDELETE\s+FROM\b/i },
  { reason: "data delete (TRUNCATE)", re: /\bTRUNCATE\b/i },
  { reason: "data rewrite (UPDATE … SET)", re: /\bUPDATE\s+\S+\s+SET\b/i },
  { reason: "touches payments", re: /(?<![\w])"?payments"?(?!\w)/i },
  { reason: "touches orders", re: /(?<![\w])"?orders"?(?!\w)/i },
  { reason: "touches order_items", re: /(?<![\w])"?order_items"?(?!\w)/i },
];

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Drop the target of every `REFERENCES <table>` (owner decision, Nikao,
 * 22 Oct 2026). A foreign key pointing AT orders/payments/order_items — in a
 * CREATE TABLE or an `ALTER TABLE <other> ADD CONSTRAINT … FOREIGN KEY` — does
 * not touch those tables, so it must not count as "touches orders" (it made
 * 0034's walk_ins table look risky). Anything that alters, drops, updates or
 * deletes them still names them outside a REFERENCES clause and is still caught.
 */
function stripForeignKeyTargets(sql: string): string {
  return sql.replace(/\bREFERENCES\s+(?:"?\w+"?\s*\.\s*)?"?\w+"?/gi, "REFERENCES <fk-target>");
}

/**
 * Why a migration's SQL counts as risky; empty if it does not. Comments and
 * foreign-key targets are ignored.
 */
export function riskyReasons(sql: string): string[] {
  const body = stripForeignKeyTargets(stripComments(sql));
  return RISKY_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.reason);
}

/** True if the marker is on a comment line before the first SQL statement. */
export function hasApprovalMarker(sql: string): boolean {
  for (const raw of sql.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (!line.startsWith("--")) return false;
    if (new RegExp(`^--\\s*${APPROVAL_MARKER}(\\s|$)`).test(line)) return true;
  }
  return false;
}

/** Exact tags listed in FAVO_APPROVE_MIGRATION (comma-separated). */
export function approvedTags(env: Record<string, string | undefined>): Set<string> {
  return new Set(
    (env[APPROVAL_ENV] ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

export interface MigrationFile {
  idx: number;
  tag: string;
  sql: string;
}

export interface ApprovalCheck {
  /** Pending migrations that need approval and do not have it. */
  refused: { tag: string; reasons: string[] }[];
  /** Pending migrations that need approval and have it. */
  approved: string[];
  /** Approved tags that are not pending (already applied, or a typo). */
  unused: string[];
}

/**
 * Which pending migrations need an approval this start does not have.
 * A migration needs approval if it carries the marker, or — as a backstop to
 * the CI gate — if it is at or after GATED_FROM_IDX and matches a risky pattern.
 */
export function checkPendingApprovals(
  pending: readonly MigrationFile[],
  env: Record<string, string | undefined>,
): ApprovalCheck {
  const approvedSet = approvedTags(env);
  const refused: ApprovalCheck["refused"] = [];
  const approved: string[] = [];

  for (const m of pending) {
    const reasons = riskyReasons(m.sql);
    const marked = hasApprovalMarker(m.sql);
    if (!marked && (m.idx < GATED_FROM_IDX || reasons.length === 0)) continue;
    if (approvedSet.has(m.tag)) approved.push(m.tag);
    else refused.push({ tag: m.tag, reasons: reasons.length > 0 ? reasons : ["marked"] });
  }

  const pendingTags = new Set(pending.map((m) => m.tag));
  const unused = [...approvedSet].filter((t) => !pendingTags.has(t));
  return { refused, approved, unused };
}

/** The operator-facing refusal, naming each tag and the backup step. */
export function refusalMessage(refused: ApprovalCheck["refused"]): string {
  const list = refused.map((r) => `  - ${r.tag} (${r.reasons.join(", ")})`).join("\n");
  return [
    `${refused.length} pending migration(s) need explicit approval before they can run:`,
    list,
    "Nothing has been applied. Before approving:",
    "  1. Take a full backup AND verify it restores (PRD §13.3 step 1).",
    `  2. Set ${APPROVAL_ENV}=<tag>[,<tag>] naming exactly these migrations, for this deploy only.`,
    `  3. Restart. Remove ${APPROVAL_ENV} once the migration has applied.`,
  ].join("\n");
}

/** CI gate: migrations at or after GATED_FROM_IDX that look risky but lack the marker. */
export function unmarkedRiskyMigrations(files: readonly MigrationFile[]): { tag: string; reasons: string[] }[] {
  return files
    .filter((f) => f.idx >= GATED_FROM_IDX && !hasApprovalMarker(f.sql))
    .map((f) => ({ tag: f.tag, reasons: riskyReasons(f.sql) }))
    .filter((f) => f.reasons.length > 0);
}
