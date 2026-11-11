"use client";

// AT-203 — /admin/funds, the blessing funds' desk surface (PRD v7.0 §6.10.3,
// §6.10.5, §10.7, §13.9). Admin only: the page, the (dashboard) layout and
// every action it calls authorise "admin".
//
//   · every active fund: balance, pending card top-ups (worth zero, REQ-173),
//     member list, last draw, and its ledger
//   · create a fund — §6.10.3 step 1's two buttons, "For specific people" or
//     "For anyone", and a name field; the non-refundability acknowledgement (L45)
//   · record a cash or EFT gift with its funding_method and reference (REQ-161:
//     the server refuses without them and writes nothing)
//
// There is no customer-facing counterpart and no top-up link or QR (L44).
// Money is integer cents end to end; parseZar turns the typed rands into cents.

import { useState } from "react";
import { toast } from "sonner";
import { createDonorFund, listFundsForAdmin, topUpDonorFund, type AdminFundListItem } from "@/server/actions/funds";
import { searchCustomer } from "@/server/actions/customers";
import { formatDate, formatZar, parseZar } from "@/lib/format";
import type { CustomerSearchResult } from "@/lib/types";

/** The server's own L45 wording (createDonorFund refuses without the acknowledgement). */
export const NON_REFUNDABLE_ACK = "Tell the donor the gift is non-refundable, and confirm they understood.";

/**
 * No answer from the server is NOT "nothing was saved": it may have committed
 * before the connection dropped. No idempotency key exists and the ledger has
 * no undo, so the copy says so, the list reloads, and there is no blind retry.
 */
export const TOPUP_UNCONFIRMED =
  "We couldn't confirm whether this top-up was saved. Check this fund's ledger below before recording it again.";
export const CHECKED_LEDGER = "I've checked the ledger";
export const CREATE_UNCONFIRMED =
  "We couldn't confirm whether this fund was created. Check the fund list below before creating it again.";
export const CHECKED_FUNDS = "I've checked the fund list";

const KIND_LABEL: Record<AdminFundListItem["entries"][number]["kind"], string> = {
  top_up: "top-up",
  spend: "draw",
  sweep: "sweep",
  adjustment: "adjustment",
};

const input =
  "w-full rounded-md border border-border-subtle bg-elevated px-3 py-2 favo-small text-text-strong min-h-[44px]";
const button =
  "rounded-md border border-border-subtle px-4 py-2 min-h-[44px] favo-small text-text-strong hover:bg-coffee-bean/8 disabled:opacity-40";

export default function FundsManager({ initialFunds }: { initialFunds: AdminFundListItem[] }) {
  const [funds, setFunds] = useState(initialFunds);

  async function refresh() {
    const r = await listFundsForAdmin().catch(() => null);
    if (r?.ok) setFunds(r.data.funds);
    else toast.error(r?.message ?? "Couldn't reload the funds.");
  }

  return (
    <div className="space-y-8">
      <CreateFundForm onCreated={refresh} />
      {funds.length === 0 ? (
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          No blessing funds yet — create one above.
        </p>
      ) : (
        funds.map((f) => <FundCard key={f.fundId} fund={f} onChanged={refresh} />)
      )}
    </div>
  );
}

function CreateFundForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState("");
  const [forSpecificPeople, setForSpecificPeople] = useState<boolean | null>(null);
  const [people, setPeople] = useState<CustomerSearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSearchResult[]>([]);
  const [amount, setAmount] = useState("");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  async function search() {
    const r = await searchCustomer(query).catch(() => null);
    if (r?.ok) setResults(r.data);
    else setError(r?.message ?? "Couldn't search.");
  }

  async function submit() {
    if (unconfirmed) return;
    setError(null);
    if (forSpecificPeople === null) return setError("Choose For specific people or For anyone.");
    const amountZar = parseZar(amount);
    if (amountZar === null || amountZar <= 0) return setError("Enter the amount in rands, above R0.");
    setBusy(true);
    try {
      const r = await createDonorFund({
        displayName: displayName.trim() === "" ? null : displayName.trim(),
        forSpecificPeople,
        customerIds: forSpecificPeople ? people.map((p) => p.id) : [],
        nonRefundableAcknowledged: ack,
        amountZar,
      });
      if (!r.ok) return setError(r.message);
      toast.success(`Fund ${r.data.code} created. Record the gift below.`);
      setDisplayName(""); setForSpecificPeople(null); setPeople([]); setResults([]); setQuery(""); setAmount(""); setAck(false);
      await onCreated();
    } catch {
      // No answer: the fund may exist. Reload the list; never a blind retry.
      setUnconfirmed(true);
      setError(CREATE_UNCONFIRMED);
      await onCreated().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Create a blessing fund" className="rounded-md border border-border-subtle p-4 space-y-3">
      <h2 className="favo-h3">Create a blessing fund</h2>
      <label className="block favo-small">
        Name
        <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
      </label>
      <div className="flex gap-2" role="group" aria-label="Who the fund is for">
        <button type="button" className={button} aria-pressed={forSpecificPeople === true} onClick={() => setForSpecificPeople(true)}>
          For specific people
        </button>
        <button type="button" className={button} aria-pressed={forSpecificPeople === false} onClick={() => { setForSpecificPeople(false); setPeople([]); }}>
          For anyone
        </button>
      </div>
      {forSpecificPeople === true && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input className={input} aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className={button} onClick={() => void search()}>Search</button>
          </div>
          {results.length > 0 && (
            <ul className="space-y-1">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" className={button} disabled={people.some((p) => p.id === c.id)}
                    onClick={() => setPeople((prev) => [...prev, c])}>
                    Add {[c.name, c.surname].filter(Boolean).join(" ")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {people.length > 0 && (
            <ul aria-label="Linked names" className="flex flex-wrap gap-2">
              {people.map((p) => (
                <li key={p.id}>
                  <button type="button" className={button} onClick={() => setPeople((prev) => prev.filter((x) => x.id !== p.id))}>
                    {[p.name, p.surname].filter(Boolean).join(" ")} ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <label className="block favo-small">
        Amount (R)
        <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 favo-small">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        {NON_REFUNDABLE_ACK}
      </label>
      {error && <p role="alert" className="favo-small" style={{ color: "var(--color-error)" }}>{error}</p>}
      {unconfirmed ? (
        <button type="button" className={button} onClick={() => { setUnconfirmed(false); setError(null); }}>
          {CHECKED_FUNDS}
        </button>
      ) : (
        <button type="button" className={button} disabled={busy} onClick={() => void submit()}>Create fund</button>
      )}
    </section>
  );
}

function FundCard({ fund, onChanged }: { fund: AdminFundListItem; onChanged: () => Promise<void> }) {
  const title = fund.displayName ?? fund.code;
  return (
    <section aria-label={title} className="rounded-md border border-border-subtle p-4 space-y-3">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="favo-h3">{title}</h2>
        <span className="favo-small" data-testid="fund-code">{fund.code}</span>
        <span className="favo-small" data-testid="fund-balance">Balance {formatZar(fund.balanceZar)}</span>
        {fund.pendingTopupsZar > 0 && (
          <span className="favo-small" data-testid="fund-pending">Pending card top-ups {formatZar(fund.pendingTopupsZar)} — not yet counted</span>
        )}
        {fund.dormant === true && <span className="favo-small" style={{ color: "var(--color-warning)" }}>dormant</span>}
      </header>
      <p className="favo-small" data-testid="fund-members">
        {fund.members.length === 0 ? "For anyone" : `For: ${fund.members.map((m) => m.name).join(", ")}`}
      </p>
      <p className="favo-small" data-testid="fund-last-draw">
        Last draw: {fund.lastDrawAt ? formatDate(fund.lastDrawAt) : "none yet"}
      </p>
      <TopUpForm fundId={fund.fundId} onDone={onChanged} />
      <table className="w-full favo-small" aria-label={`Ledger — ${title}`}>
        <thead>
          <tr>
            <th className="text-left">When</th>
            <th className="text-left">Entry</th>
            <th className="text-right">Amount</th>
            <th className="text-left">Method</th>
            <th className="text-left">Reference</th>
            <th className="text-left">Reason</th>
            <th className="text-left">Payment</th>
          </tr>
        </thead>
        <tbody>
          {fund.entries.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.at)}</td>
              <td>{KIND_LABEL[e.kind]}</td>
              <td className="text-right">{formatZar(e.amountZar)}</td>
              <td>{e.fundingMethod ?? ""}</td>
              <td>{e.reference ?? ""}</td>
              <td>{e.reason ?? ""}</td>
              <td>{e.status ?? ""}{e.status !== null && !e.counts ? " · not counted" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TopUpForm({ fundId, onDone }: { fundId: string; onDone: () => Promise<void> }) {
  const [method, setMethod] = useState<"cash" | "eft" | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);

  async function submit() {
    if (unconfirmed) return;
    setError(null);
    const amountZar = parseZar(amount);
    if (amountZar === null || amountZar <= 0) return setError("Enter the amount in rands, above R0.");
    setBusy(true);
    try {
      // The server is the gate (REQ-161): no method or reference → VALIDATION, nothing written.
      const r = await topUpDonorFund({ fundId, amountZar, fundingMethod: method, reference, reason });
      if (!r.ok) return setError(r.message);
      toast.success(`Recorded. Balance ${formatZar(r.data.balanceZar)}.`);
      setMethod(null); setAmount(""); setReference(""); setReason("");
      await onDone();
    } catch {
      // No answer: the server may have committed before the connection dropped.
      // There is no idempotency key and no undo, so never offer a blind retry —
      // reload the ledger and make the Admin look first.
      setUnconfirmed(true);
      setError(TOPUP_UNCONFIRMED);
      await onDone().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Record a cash or EFT gift" className="space-y-2">
      <div className="flex gap-2" role="group" aria-label="Funding method">
        <button type="button" className={button} aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>Cash</button>
        <button type="button" className={button} aria-pressed={method === "eft"} onClick={() => setMethod("eft")}>EFT</button>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <label className="favo-small">Amount (R)<input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="favo-small">Reference<input className={input} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        <label className="favo-small">Reason<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {error && <p role="alert" className="favo-small" style={{ color: "var(--color-error)" }}>{error}</p>}
      {unconfirmed ? (
        <button type="button" className={button} onClick={() => { setUnconfirmed(false); setError(null); }}>
          {CHECKED_LEDGER}
        </button>
      ) : (
        <button type="button" className={button} disabled={busy} onClick={() => void submit()}>Record top-up</button>
      )}
    </div>
  );
}
