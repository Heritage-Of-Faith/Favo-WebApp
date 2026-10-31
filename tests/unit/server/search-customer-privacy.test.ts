// AT-185 / AT-213 / REQ-142 — searchCustomer must not leak email or the full
// phone, and must let two people with one given name be told apart.
// REQ-142: "Given any search response · When its payload is inspected · Then it
// carries no email address and no full phone number, and two results sharing a
// given name are distinguishable by surname or by four phone digits".
// PRD §6.9.4a (DEF-F): matches "Given name, surname, or phone … Prefix match on
// names, and on the last four digits of a phone"; fires at 2 characters; at
// most 10 results.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff-1", role: "barista" },
  }),
}));

function buildDbMock(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { searchCustomer } from "@/server/actions/customers";
import { _resetStoreForTest } from "@/server/rate-limit";

// The row as the database holds it (post-AT-211: `name` is the given name,
// `surname` its own column). The mock deliberately returns email, the full
// phone and status even if the action does not ask for them, so the test proves
// the action strips them rather than relying on the select alone.
const LOUIS_ROW = {
  id: "cust-louis",
  name: "Louis",
  surname: "Botha",
  phone: "+27821234567",
  email: "louis@example.com",
  status: "office_staff",
};

/** Render the WHERE condition passed to the query builder as SQL text + params. */
function renderWhere(mock: ReturnType<typeof buildDbMock>) {
  const cond = mock.where.mock.calls[0]?.[0];
  expect(cond).toBeDefined();
  return new PgDialect().sqlToQuery(cond as Parameters<PgDialect["sqlToQuery"]>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Each test starts with a fresh per-staff search budget, so the matching
  // tests never trip the rate limit.
  _resetStoreForTest();
});

describe("searchCustomer — REQ-142 payload privacy", () => {
  it("returns no email, no full phone and no status — only id, name, surname, last four digits", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([LOUIS_ROW]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("Lou");

    // (a)
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);

    // (b) no result object carries an email, phone or status key; the key set is exact
    for (const r of result.data) {
      expect(r).not.toHaveProperty("email");
      expect(r).not.toHaveProperty("phone");
      expect(r).not.toHaveProperty("status");
      expect(Object.keys(r).sort()).toEqual(["id", "name", "phoneLast4", "surname"]);
    }

    // (c) the serialised payload contains neither value, nor the national number
    const payload = JSON.stringify(result);
    expect(payload).not.toContain("louis@example.com");
    expect(payload).not.toContain("+27821234567");
    expect(payload).not.toContain("821234567");
    expect(payload).not.toContain("office_staff");

    // (d)
    expect(result.data[0]).toEqual({ id: "cust-louis", name: "Louis", surname: "Botha", phoneLast4: "4567" });
  });

  it("does not request email or status in the select projection", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([LOUIS_ROW]) as unknown as ReturnType<typeof db.select>
    );

    await searchCustomer("Lou");

    // phone is still read server-side to derive the last four digits; it is
    // stripped before the response (asserted above). email is never read.
    const projection = vi.mocked(db.select).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(projection).toBeDefined();
    expect(Object.keys(projection ?? {})).not.toContain("email");
    expect(Object.keys(projection ?? {})).not.toContain("status");
  });

  it("(e) two results both named Louis are distinguishable by four phone digits", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([
        { id: "c1", name: "Louis", surname: null, phone: "+27821234567", email: null },
        { id: "c2", name: "Louis", surname: null, phone: "+27839876543", email: null },
      ]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("Louis");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.phoneLast4)).toEqual(["4567", "6543"]);
    expect(result.data[0]!.phoneLast4).not.toBe(result.data[1]!.phoneLast4);
  });

  it("(f) two results both named Thandeka are distinguishable by surname", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([
        { id: "c1", name: "Thandeka", surname: "Dlamini", phone: null, email: null },
        { id: "c2", name: "Thandeka", surname: "Mokoena", phone: null, email: null },
      ]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("tha");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { id: "c1", name: "Thandeka", surname: "Dlamini", phoneLast4: null },
      { id: "c2", name: "Thandeka", surname: "Mokoena", phoneLast4: null },
    ]);
    expect(result.data[0]!.name).toBe(result.data[1]!.name);
    expect(result.data[0]!.surname).not.toBe(result.data[1]!.surname);
  });

  it("phoneLast4 and surname are null when absent (a customer with no surname still works)", async () => {
    vi.mocked(db.select).mockReturnValue(
      buildDbMock([
        { id: "c1", name: "Thandeka", surname: null, phone: null, email: "t@example.com" },
        { id: "c2", name: "Nkuli", surname: null, phone: "123", email: null },
      ]) as unknown as ReturnType<typeof db.select>
    );

    const result = await searchCustomer("ka");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.phoneLast4)).toEqual([null, null]);
    expect(result.data.map((r) => r.surname)).toEqual([null, null]);
    expect(JSON.stringify(result)).not.toContain("t@example.com");
  });
});

describe("searchCustomer — DEF-F matching (§6.9.4a)", () => {
  function run(query: string) {
    const mock = buildDbMock([]);
    vi.mocked(db.select).mockReturnValue(mock as unknown as ReturnType<typeof db.select>);
    return searchCustomer(query).then((result) => ({ result, mock }));
  }

  it("prefix-matches the given name and the surname, case-insensitively", async () => {
    const { result, mock } = await run("Bot");
    expect(result).toEqual({ ok: true, data: [] }); // zero results is not an error
    const { sql, params } = renderWhere(mock);
    expect(sql).toContain(`"customers"."name" ilike`);
    expect(sql).toContain(`"customers"."surname" ilike`);
    // prefix, not substring: the pattern ends in % and does not start with one
    expect(params).toContain("Bot%");
    expect(params).not.toContain("%Bot%");
  });

  it("a 'Given Surname' query prefix-matches the given name AND the surname", async () => {
    const { mock } = await run("  Thandeka  Mok ");
    const { sql, params } = renderWhere(mock);
    expect(params).toContain("Thandeka%");
    expect(params).toContain("Mok%");
    expect(sql).toMatch(/"customers"\."name" ilike \$\d+ and "customers"\."surname" ilike \$\d+/);
  });

  it("escapes LIKE wildcards in the query so a prefix stays a prefix", async () => {
    const { mock } = await run("%ou");
    const { params } = renderWhere(mock);
    expect(params).toContain("\\%ou%");
    expect(params).not.toContain("%ou%");
  });

  it("an exact full phone number still matches", async () => {
    const { mock } = await run("+27821234567");
    const { sql, params } = renderWhere(mock);
    expect(sql).toMatch(/"customers"\."phone" = \$\d+/);
    expect(params).toContain("+27821234567");
  });

  it("2–4 digits prefix-match the last four digits of the phone", async () => {
    const { mock } = await run("4567");
    const { sql, params } = renderWhere(mock);
    expect(sql).toContain(`right(regexp_replace("customers"."phone", '\\D', '', 'g'), 4) like`);
    expect(params).toContain("4567%");
  });

  it("a name query does not trigger the last-four phone match", async () => {
    const { sql } = renderWhere((await run("Lou")).mock);
    expect(sql).not.toContain("regexp_replace");
  });

  it("caps results at 10", async () => {
    const { mock } = await run("Lou");
    expect(mock.limit).toHaveBeenCalledWith(10);
  });

  it("refuses a query shorter than 2 characters after trimming, without touching the db", async () => {
    const result = await searchCustomer(" L ");
    expect(result).toMatchObject({ ok: false, code: "QUERY_TOO_SHORT" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("is gated to barista and admin", async () => {
    await run("Lou");
    expect(authorize).toHaveBeenCalledWith("barista", "admin");
  });
});

describe("searchCustomer — per-staff rate limit (review round)", () => {
  it("allows 60 searches a minute, then refuses with a friendly message", async () => {
    _resetStoreForTest();
    vi.mocked(db.select).mockReturnValue(buildDbMock([]) as unknown as ReturnType<typeof db.select>);
    for (let i = 0; i < 60; i++) {
      expect((await searchCustomer("Lou")).ok).toBe(true);
    }
    const blocked = await searchCustomer("Lou");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("RATE_LIMITED");
      expect(blocked.message).toMatch(/too fast/i);
    }
    _resetStoreForTest();
  });
});
