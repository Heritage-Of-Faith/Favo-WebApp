// T10 — the daily reconciliation's exception list (PRD v7.0 §6.8.3, REQ-019,
// REQ-032, REQ-033, REQ-034, REQ-120, DEC-17, §7.0.4's fee-rate flag).
// Presentational: the page reads the view
// through the Admin-only getT10 action. Shows Yoco ids, FAVO order ids and
// amounts only — no customer data. Headings and wording are not PRD copy.

import { formatZar } from "@/lib/format";
import type { ExceptionKind } from "@/server/reconciliation/t10";
import type { T10View, WriteOffT10Status } from "@/server/reconciliation/t10-view";
import { openPayoutCount, type PayoutLine } from "@/server/reconciliation/payout";
import type { FeeRateCheck } from "@/server/reconciliation/fee-anomaly";
import CheckWithYocoButton from "./CheckWithYocoButton";
import ConfirmNoYocoPaymentForm from "./ConfirmNoYocoPaymentForm";
import ClearTipForm from "./ClearTipForm";
import YocoPayoutForm from "./YocoPayoutForm";
import ConfirmPayoutVarianceForm from "./ConfirmPayoutVarianceForm";

const KIND_LABEL: Record<ExceptionKind, string> = {
  malformed: "Could not read",
  other_day: "Another day",
  duplicate_in_file: "Listed twice",
  unmatched: "In Yoco, not in FAVO",
  ambiguous: "Matches more than one",
  two_yoco_rows_one_payment: "Possible double charge",
  needs_attach: "Needs attaching",
  status_disagrees: "Status disagrees",
  amount_variance: "Amount differs",
  tip: "Tip came through",
  fee_conflict: "Fee differs",
  receipt_conflict: "Receipt differs",
};

const WRITE_OFF_LABEL: Record<WriteOffT10Status, string> = {
  waiting_for_export: "Waiting for Yoco's export for this day",
  yoco_shows_payment: "Yoco shows a payment",
  export_inconclusive: "Export can't rule it out (unreadable or other-day rows, or no reference column): Admin to check",
  export_no_match: "Export has no matching row: Admin to confirm",
  confirmed_no_payment: "Admin confirmed: no Yoco payment",
};

const short = (id: string | null) => (id ? id.slice(0, 8) : "—");
const muted = { color: "var(--color-text-muted)" } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const warn = { color: "var(--status-warn)" } as const;

function TipClearing({ paymentId, withheld, view }: { paymentId: string; withheld: boolean; view: T10View }) {
  if (view.clearedTipPaymentIds.includes(paymentId)) return <p style={muted}>Cleared by an Admin.</p>;
  if (!withheld) return <p style={muted}>Upload this day&apos;s export again to clear this tip.</p>;
  return <ClearTipForm paymentId={paymentId} revenueDay={view.revenueDay} />;
}

function PayoutLineText({ line }: { line: PayoutLine }) {
  const { check } = line;
  const head = `Device ${check.deviceId} · payout ${formatZar(check.payoutZar)} · ${check.count} card payments`;
  if (check.state === "unavailable") {
    const parts = [
      check.missingFee > 0 ? `${check.missingFee} without a fee yet` : null,
      check.missingCharged > 0 ? `${check.missingCharged} without a charged amount` : null,
    ].filter(Boolean);
    return (
      <span>
        {head} · <strong style={warn}>UNAVAILABLE</strong>: {parts.join(", ")}.
      </span>
    );
  }
  if (check.state === "ok") {
    return <span>{head} · charges less fees {formatZar(check.expectedZar)} · matches.</span>;
  }
  return (
    <span>
      {head} · charges less fees {formatZar(check.expectedZar)} ·{" "}
      <strong style={warn}>
        difference {check.differenceZar > 0 ? "+" : "−"}
        {formatZar(Math.abs(check.differenceZar))}
      </strong>{" "}
      {line.confirmation ? (
        <>· confirmed by an Admin (closed): {line.confirmation.reason}</>
      ) : line.mayBeClearedTip ? (
        <>
          · <strong style={warn}>difference may be a cleared tip: Admin to confirm</strong>. Open.
        </>
      ) : (
        <>(a tip that came through shows here). Open: an Admin to look into it.</>
      )}
    </span>
  );
}

function FeeRateLine({ check }: { check: FeeRateCheck }) {
  const label = "Card fee rate (for information)";
  if (check.state === "invalid_config") return <p style={muted}>{label}: expected_fee_rate_bp is set but is not a whole number of basis points.</p>;
  if (check.state === "not_applicable") return <p style={muted}>{label}: not applicable — {check.count} card payments (needs at least 10).</p>;
  if (check.state === "unavailable") {
    return <p style={muted}>{label}: unavailable — {check.missingFee + check.missingCharged} card payments have no fee or charged amount yet.</p>;
  }
  const realised = `${Math.floor(check.realisedTenthsBp / 10)}.${check.realisedTenthsBp % 10} bp`;
  return check.state === "anomaly" ? (
    <p>
      {label}: <strong style={warn}>anomaly</strong> — realised {realised} against an expected {check.expectedBp} bp (band ±15 bp),
      over {check.count} card payments. Nothing is recalculated; Yoco&apos;s fees stand.
    </p>
  ) : (
    <p style={muted}>
      {label}: realised {realised} against an expected {check.expectedBp} bp, within ±15 bp.
    </p>
  );
}

export default function T10Panel({ view }: { view: T10View }) {
  const imp = view.latestImport;
  const openWriteOffs = view.writeOffs.filter((w) => w.open);
  // A closed one stays written off for good, so only the viewed day's are shown.
  const closedWriteOffs = view.writeOffs.filter((w) => !w.open && w.revenueDay === view.revenueDay);

  return (
    <div className="space-y-6 favo-small">
      {imp === null ? (
        <p style={muted}>
          No Yoco export has been imported for {view.revenueDay}. Until one is, this day&apos;s fees, net settled and
          contribution stay unavailable.
        </p>
      ) : (
        <>
          <p>
            Imported {new Date(imp.importedAt).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}.{" "}
            <strong>
              {imp.unmatchedRows} of {imp.totalRows} rows unmatched
            </strong>{" "}
            · {imp.matchedRows} matched · Yoco gross {formatZar(imp.yocoGrossZar)} · Yoco fees {formatZar(imp.yocoFeeZar)}
            {" "}· {imp.annotatedPayments} payments given their fee this time.
          </p>
          {imp.notes.map((n) => (
            <p key={n} style={muted}>{n}</p>
          ))}

          <Section title={`To check (${imp.exceptions.length})`}>
            {imp.exceptions.length === 0 ? (
              <p style={muted}>Nothing to check.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left">
                    <th className="px-2 py-1">What</th>
                    <th className="px-2 py-1">Row</th>
                    <th className="px-2 py-1">Yoco id</th>
                    <th className="px-2 py-1">FAVO order</th>
                    <th className="px-2 py-1 text-right">Yoco amount</th>
                    <th className="px-2 py-1">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {imp.exceptions.map((e, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="px-2 py-1">{KIND_LABEL[e.kind] ?? e.kind}</td>
                      <td className="px-2 py-1">{e.line ?? "—"}</td>
                      <td className="px-2 py-1">{e.yocoPaymentId ?? "—"}</td>
                      <td className="px-2 py-1" title={e.orderId ?? undefined}>{short(e.orderId)}</td>
                      <td className="px-2 py-1 text-right">{e.amountZar === null ? "—" : formatZar(e.amountZar)}</td>
                      <td className="px-2 py-1">
                        {e.detail}
                        {e.kind === "tip" && e.paymentId !== null && <TipClearing paymentId={e.paymentId} withheld={!!e.withheld} view={view} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title={`In FAVO, not in Yoco's export (${imp.missingFromYoco.length})`}>
            {imp.missingFromYoco.length === 0 ? (
              <p style={muted}>None.</p>
            ) : (
              <ul className="space-y-1">
                {imp.missingFromYoco.map((m) => (
                  <li key={m.paymentId}>
                    {m.orderId ? `Order ${short(m.orderId)}` : `Fund top-up ${short(m.fundTopupId)}`} · {formatZar(m.amountZar)} · Yoco id{" "}
                    {m.yocoPaymentId ?? "none held"}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`For information (${imp.info.length})`}>
            {imp.info.length === 0 ? (
              <p style={muted}>None.</p>
            ) : (
              <ul className="space-y-1">
                {imp.info.map((n) => (
                  <li key={n.yocoPaymentId}>
                    {n.kind === "retail" ? "Retail sale outside the menu" : `Paid on the standalone machine (order ${short(n.orderId)})`} ·{" "}
                    Yoco id {n.yocoPaymentId} · {formatZar(n.amountZar)}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <Section title={`Yoco payout check (${openPayoutCount(view.payouts)} open)`}>
        <p style={muted}>
          Type the payout Yoco made for this day and card machine. FAVO compares it with the sum of each settled card
          payment&apos;s charge less its fee.
        </p>
        <YocoPayoutForm revenueDay={view.revenueDay} defaultDeviceId={view.defaultDeviceId} />
        {view.payouts.length > 0 && (
          <ul className="space-y-1">
            {view.payouts.map((p) => (
              <li key={p.check.deviceId}>
                <PayoutLineText line={p} />
                {p.open && p.check.state === "variance" && (
                  <ConfirmPayoutVarianceForm revenueDay={view.revenueDay} deviceId={p.check.deviceId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <FeeRateLine check={view.feeRate} />

      <Section title={`Write-offs that may hold money (${openWriteOffs.length} open)`}>
        {openWriteOffs.length + closedWriteOffs.length === 0 ? (
          <p style={muted}>None.</p>
        ) : (
          <ul className="space-y-2">
            {[...openWriteOffs, ...closedWriteOffs].map((w) => (
              <li key={w.orderId} className="flex flex-wrap items-center gap-3">
                <span title={w.orderId}>
                  Order {short(w.orderId)} · {w.revenueDay} · {formatZar(w.totalZar)} · {WRITE_OFF_LABEL[w.status]}
                  {w.open ? "" : " (closed)"}
                </span>
                {w.status === "yoco_shows_payment" && <CheckWithYocoButton orderId={w.orderId} />}
                {(w.status === "export_no_match" || w.status === "export_inconclusive") && (
                  <ConfirmNoYocoPaymentForm orderId={w.orderId} revenueDay={w.revenueDay} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
