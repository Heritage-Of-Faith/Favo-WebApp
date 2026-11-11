// T10 / §11.2 importYocoTransactions — the parser for Yoco's own transaction
// export, uploaded by an Admin at /admin/reports (PRD v7.0 §6.8.3: "There is no
// automatic fetch"). Pure: no DB, no network, no clock.
//
// ⚠ UNVERIFIED LAYOUT. Nobody has checked these column names against a real
// Yoco export file. YOCO_EXPORT_COLUMNS below is the ONE place the mapping
// lives: when a real export arrives, fix the aliases here and nowhere else.
// Matching is case-, space- and punctuation-insensitive ("Payment ID",
// "payment_id" and "PAYMENTID" are the same header).
//
// Never guess (REQ-033, §6.8.3):
//   - a header that two canonical fields could claim refuses the whole file;
//   - a cell that does not parse sends its row to the exception list with the
//     reason, and that row is matched to nothing and writes nothing;
//   - money is read as a string into integer cents — no float ever touches it;
//   - a date like 03/04/2026 (day-first or month-first?) is refused, not read.
// Columns not in the table (e.g. a card holder's name) are never read, and no
// rejection reason echoes a cell's text: only ids, amounts and fixed wording.

// ─── the mapping table ────────────────────────────────────────────────────────

export type YocoField =
  | "yocoPaymentId"
  | "clientReference"
  | "amount"
  | "fee"
  | "net"
  | "date"
  | "time"
  | "receiptNo"
  | "items"
  | "tip"
  | "status"
  | "type";

/** UNVERIFIED against a real Yoco export. Aliases are compared after normaliseHeader(). */
export const YOCO_EXPORT_COLUMNS: Record<YocoField, { required: boolean; aliases: string[] }> = {
  yocoPaymentId: { required: true, aliases: ["paymentid", "yocopaymentid", "yocoid", "transactionid"] },
  clientReference: { required: false, aliases: ["clientreference", "externalreference", "reference"] },
  amount: { required: true, aliases: ["amount", "grossamount", "gross", "total", "totalamount", "chargedamount", "saleamount"] },
  fee: { required: true, aliases: ["fee", "fees", "processingfee", "processingfees", "transactionfee", "yocofee"] },
  net: { required: false, aliases: ["net", "netamount", "netsettled"] },
  date: { required: true, aliases: ["date", "datetime", "dateandtime", "transactiondate", "createdat", "timestamp"] },
  time: { required: false, aliases: ["time", "transactiontime"] },
  receiptNo: { required: false, aliases: ["receiptnumber", "receiptno", "receipt", "slipnumber", "slipno", "slip"] },
  // No "description": a free-text column is never read as an item list (S7d retail must be explicit).
  items: { required: false, aliases: ["items", "item", "products", "product", "productname", "lineitems"] },
  tip: { required: false, aliases: ["tip", "tips", "tipamount", "gratuity"] },
  status: { required: false, aliases: ["status", "result", "outcome"] },
  type: { required: false, aliases: ["type", "transactiontype"] },
};

/** UNVERIFIED. A status cell outside both lists sends the row to the exception list. */
export const YOCO_STATUS_VALUES = {
  successful: ["successful", "success", "succeeded", "approved", "completed", "complete", "paid"],
  failed: ["failed", "declined", "cancelled", "canceled"],
} as const;

/** UNVERIFIED. A type cell outside this list (e.g. a reversal) sends the row to the exception list. */
export const YOCO_PAYMENT_TYPES = ["payment", "sale", "charge", "purchase", "cardpayment", "card"] as const;

/** Upload caps. A Sunday is ~45 transactions; these leave a wide margin. */
export const MAX_EXPORT_BYTES = 512 * 1024;
export const MAX_EXPORT_ROWS = 2000;

export function normaliseHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ─── cells ────────────────────────────────────────────────────────────────────

export type CentsParse = { ok: true; cents: number } | { ok: false; reason: string };

/**
 * A rand amount → integer cents, by string arithmetic only.
 *   "20" "20.00" "R20.00" "R 1 234.56" "1,234.56" → plain
 *   "20,00" → a decimal comma (exactly two digits after it)
 *   "1,234" (thousands or decimals? — a thousands comma needs the decimal
 *   point beside it) "20.555" "abc" → refused
 *   "-0.53" "(0.53)" → refused here as negative; the caller names why
 */
export function parseCents(raw: string): CentsParse {
  let s = raw.trim().replace(/[\s\u00A0]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/^(ZAR|R)/i, "");
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (s === "") return { ok: false, reason: "empty" };

  let whole: string;
  let frac = "";
  if (/^\d+$/.test(s)) {
    whole = s;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [whole, frac] = s.split(".");
  } else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(s)) {
    const [w, f = ""] = s.split(".");
    whole = w.replace(/,/g, "");
    frac = f;
  } else if (/^\d+,\d{2}$/.test(s)) {
    [whole, frac] = s.split(",");
  } else {
    return { ok: false, reason: "not a rand amount FAVO can read without guessing" };
  }
  if (whole.length > 9) return { ok: false, reason: "too large" };
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (negative && cents !== 0) return { ok: false, reason: "negative" };
  return { ok: true, cents };
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** The SAST calendar day of a UTC instant (SAST is UTC+2, no daylight saving). */
function sastDay(d: Date): string {
  return new Date(d.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The SAST revenue day a date cell names. Only unambiguous forms:
 *   2026-08-16 · 2026-08-16 08:05:51 · 2026-08-16T08:05:51 (read as SAST)
 *   2026-08-16T06:05:51Z / +02:00 (converted to SAST) · 16 Aug 2026 [08:05]
 * A slashed date (16/08/2026 or 08/16/2026) is refused: never guessed.
 */
export function parseRevenueDay(raw: string): { ok: true; day: string } | { ok: false; reason: string } {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (iso) {
    const [, y, m, d, hh, mm, ss, zone] = iso;
    if (!validYmd(y, m, d)) return { ok: false, reason: "not a real date" };
    if (!zone) return { ok: true, day: `${y}-${m}-${d}` };
    const z = zone.toUpperCase() === "Z" ? "Z" : zone.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    const t = new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss ?? "00"}${z}`);
    if (Number.isNaN(t.getTime())) return { ok: false, reason: "not a real date" };
    return { ok: true, day: sastDay(t) };
  }
  const named = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(s);
  if (named) {
    const [, d, mon, y] = named;
    const m = MONTHS[mon.toLowerCase()];
    const dd = d.padStart(2, "0");
    if (!m || !validYmd(y, m, dd)) return { ok: false, reason: "not a real date" };
    return { ok: true, day: `${y}-${m}-${dd}` };
  }
  return { ok: false, reason: "not a date FAVO can read without guessing (use YYYY-MM-DD)" };
}

function validYmd(y: string, m: string, d: string): boolean {
  const t = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === `${y}-${m}-${d}`;
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180: quoted fields, "" escapes, CRLF or LF. Returns null on an unclosed quote. */
export function splitCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) return null;
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// ─── rows ─────────────────────────────────────────────────────────────────────

export type YocoRow = {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  yocoPaymentId: string;
  clientReference: string | null;
  amountZar: number;
  feeZar: number;
  netZar: number | null;
  /** 0 when the file has no tip column. */
  tipZar: number;
  revenueDay: string;
  receiptNo: string | null;
  items: string | null;
  /** "successful" when the file has no status column (see T10 note). */
  status: "successful" | "failed";
};

export type RejectedRow = { line: number; yocoPaymentId: string | null; reason: string };

export type ParsedExport =
  | {
      ok: true;
      rows: YocoRow[];
      rejected: RejectedRow[];
      /** Plain-language notes about the file as a whole, shown on T10. */
      notes: string[];
      /** Which optional columns the file had. */
      columns: YocoField[];
    }
  | { ok: false; reason: string };

function cellText(v: string | undefined): string {
  return (v ?? "").trim();
}

export function parseYocoExport(text: string): ParsedExport {
  if (new TextEncoder().encode(text).length > MAX_EXPORT_BYTES) {
    return { ok: false, reason: `The file is larger than ${MAX_EXPORT_BYTES / 1024} KB.` };
  }
  const table = splitCsv(text);
  if (table === null) return { ok: false, reason: "The file has a quote that is never closed — it is not a readable CSV." };
  if (table.length === 0) return { ok: false, reason: "The file is empty." };
  const [header, ...body] = table;
  if (body.length > MAX_EXPORT_ROWS) return { ok: false, reason: `The file has more than ${MAX_EXPORT_ROWS} rows.` };

  // Header → field. A header two fields could claim, or a field two headers
  // claim, refuses the file: never guessed.
  const col: Partial<Record<YocoField, number>> = {};
  for (let i = 0; i < header.length; i++) {
    const h = normaliseHeader(header[i]);
    if (h === "") continue;
    const fields = (Object.keys(YOCO_EXPORT_COLUMNS) as YocoField[]).filter((f) =>
      YOCO_EXPORT_COLUMNS[f].aliases.includes(h)
    );
    if (fields.length === 0) continue;
    const f = fields[0];
    if (col[f] !== undefined) {
      return { ok: false, reason: `Two columns could both be "${f}" (columns ${(col[f] as number) + 1} and ${i + 1}). FAVO will not guess which.` };
    }
    col[f] = i;
  }
  const missing = (Object.keys(YOCO_EXPORT_COLUMNS) as YocoField[]).filter(
    (f) => YOCO_EXPORT_COLUMNS[f].required && col[f] === undefined
  );
  if (missing.length > 0) {
    return { ok: false, reason: `The file has no column FAVO recognises for: ${missing.join(", ")}.` };
  }

  const notes: string[] = [];
  if (col.status === undefined) {
    notes.push("The file has no status column, so every row is read as a completed card payment.");
  }
  if (col.tip === undefined) notes.push("The file has no tip column, so a tip cannot be checked.");

  const rows: YocoRow[] = [];
  const rejected: RejectedRow[] = [];
  body.forEach((cells, idx) => {
    const line = idx + 2;
    const get = (f: YocoField) => (col[f] === undefined ? null : cellText(cells[col[f] as number]));
    const id = get("yocoPaymentId") ?? "";
    const reject = (reason: string) => rejected.push({ line, yocoPaymentId: id === "" ? null : id, reason });

    if (id === "") return reject("No Yoco payment id.");

    const type = get("type");
    if (type !== null && type !== "" && !(YOCO_PAYMENT_TYPES as readonly string[]).includes(normaliseHeader(type))) {
      return reject("Type is not a card payment.");
    }
    let status: "successful" | "failed" = "successful";
    const st = get("status");
    if (st !== null) {
      const n = normaliseHeader(st);
      if ((YOCO_STATUS_VALUES.successful as readonly string[]).includes(n)) status = "successful";
      else if ((YOCO_STATUS_VALUES.failed as readonly string[]).includes(n)) status = "failed";
      else return reject("Status is not one FAVO recognises.");
    }

    const amount = parseCents(get("amount") ?? "");
    if (!amount.ok) {
      return reject(amount.reason === "negative" ? "Negative amount — FAVO takes no money back, so this needs a person." : `Amount: ${amount.reason}.`);
    }
    // A failed row moved no money, so a blank fee on it reads as none; its fee
    // is never written anyway. A completed row must carry Yoco's own fee.
    const feeRaw = get("fee") ?? "";
    const fee = status === "failed" && feeRaw === "" ? ({ ok: true, cents: 0 } as const) : parseCents(feeRaw);
    if (!fee.ok) return reject(fee.reason === "negative" ? "Negative fee." : `Fee: ${fee.reason}.`);

    let netZar: number | null = null;
    const netRaw = get("net");
    if (netRaw !== null && netRaw !== "") {
      const net = parseCents(netRaw);
      if (!net.ok) return reject(`Net: ${net.reason}.`);
      netZar = net.cents;
    }
    let tipZar = 0;
    const tipRaw = get("tip");
    if (tipRaw !== null && tipRaw !== "") {
      const tip = parseCents(tipRaw);
      if (!tip.ok) return reject(`Tip: ${tip.reason}.`);
      tipZar = tip.cents;
    }

    const dateRaw = get("date") ?? "";
    const timeRaw = get("time");
    const day = parseRevenueDay(timeRaw && !dateRaw.includes(":") ? `${dateRaw} ${timeRaw}` : dateRaw);
    if (!day.ok) return reject(`Date: ${day.reason}.`);

    const receipt = get("receiptNo");
    const items = get("items");
    const ref = get("clientReference");
    rows.push({
      line,
      yocoPaymentId: id,
      clientReference: ref ? ref : null,
      amountZar: amount.cents,
      feeZar: fee.cents,
      netZar,
      tipZar,
      revenueDay: day.day,
      receiptNo: receipt ? receipt : null,
      items: items ? items : null,
      status,
    });
  });

  const columns = (Object.keys(col) as YocoField[]).filter((f) => col[f] !== undefined);
  return { ok: true, rows, rejected, notes, columns };
}
