// DEC-23 / §9.6.3: the daily digest as an Admin-home card, read when the page
// renders — not a job, not a push. What FAVO cannot measure yet is said so,
// never shown as zero.

import { formatZar } from "@/lib/format";
import { FUND_LIABILITY_LINE_ZAR, type AdminDigest } from "@/server/alerts/daily-digest";

const NOT_MEASURED = "not measured yet";

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 py-1" data-testid={testId}>
      <dt className="favo-small" style={{ color: "var(--color-text-muted)", minWidth: "11rem" }}>
        {label}
      </dt>
      <dd className="favo-small" style={{ color: "var(--color-text-strong)" }}>
        {children}
      </dd>
    </div>
  );
}

function warn(on: boolean): React.CSSProperties | undefined {
  return on ? { color: "var(--color-warning)", fontWeight: 600 } : undefined;
}

export default function DailyDigestCard({ digest }: { digest: AdminDigest }) {
  const v = digest.vouchers;
  const close = digest.lastClose;
  return (
    <section
      aria-label="Daily digest"
      className="mb-6 rounded-[var(--radius-card)] border border-border-subtle bg-elevated p-4"
    >
      <h2 className="favo-subhead" style={{ color: "var(--color-text-strong)" }}>
        Daily digest — {digest.day}
      </h2>
      <dl className="mt-2">
        <Row label="Vouchers" testId="digest-vouchers">
          <span style={warn(v.flagged)}>
            {v.sessions.length === 0
              ? "No session that day."
              : `${v.voucherCount} voucher${v.voucherCount === 1 ? "" : "s"}, ${formatZar(v.voucherZar)}`}
          </span>
          {v.sessions.map((s) => (
            <span key={s.opensAt} className="block">
              Session from {s.opensAt}: {s.recorded} recorded
              {s.slipsCounted === null
                ? ", slips not counted"
                : s.slipVariance === 0
                  ? `, ${s.slipsCounted} slips — matches`
                  : `, ${s.slipsCounted} slips — does not match`}
              {s.aboveExpected === null
                ? " · expected maximum (T11) not set correctly"
                : s.aboveExpected
                  ? ` · above the expected ${v.expectedMax} per session`
                  : ""}
            </span>
          ))}
        </Row>
        <Row label="Blessing funds owed" testId="digest-funds">
          <span style={warn(digest.fundLiabilityAboveLine)}>
            {formatZar(digest.fundLiabilityZar)} across {digest.activeFundCount} active fund{digest.activeFundCount === 1 ? "" : "s"}
            {digest.fundLiabilityAboveLine ? ` — above the ${formatZar(FUND_LIABILITY_LINE_ZAR)} line` : ` (line: ${formatZar(FUND_LIABILITY_LINE_ZAR)})`}
          </span>
        </Row>
        <Row label="Last daily close" testId="digest-close">
          {close === null ? (
            <span style={warn(true)}>No day has been closed yet.</span>
          ) : (
            <span style={warn(close.reconciliationStatus === "blocked")}>
              {close.revenueDay}: {close.reconciliationStatus === "blocked" ? `blocked — ${close.blockedReason ?? ""}` : "payments matched"}
              {close.writtenOffCount > 0 ? ` · ${close.writtenOffCount} written off, ${formatZar(close.writtenOffZar)}` : ""}
              {close.wasCatchUp ? " · closed late (catch-up)" : ""}
            </span>
          )}
          {close !== null && digest.yesterdayUnclosed && (
            <span className="block" style={warn(true)}>
              {digest.day} is not closed yet.
            </span>
          )}
        </Row>
        <Row label="Yoco import (T10)" testId="digest-yoco-import">
          {digest.yocoImport === null ? (
            <span style={warn(true)}>
              No Yoco export imported for {digest.day} — its fees stay unavailable. Upload it on Reports.
            </span>
          ) : (
            <span style={warn(digest.yocoImport.toCheck > 0)}>
              {digest.yocoImport.unmatchedRows} of {digest.yocoImport.totalRows} rows unmatched ·{" "}
              {digest.yocoImport.toCheck} to check
            </span>
          )}
        </Row>
        <Row label="Storage" testId="digest-storage">
          {NOT_MEASURED}
        </Row>
        <Row label="Queue stream disconnects" testId="digest-stream">
          {NOT_MEASURED}
        </Row>
      </dl>
    </section>
  );
}
