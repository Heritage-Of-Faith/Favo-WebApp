// DEC-23 / §9.6.2 job 7 / §6.10.4: funds with no movement for T14 − 30 days
// (default 150) and funds dormant at T14 (default 180), shown on /admin and
// /admin/funds while the condition holds. Read-only: it writes nothing, and a
// sweep stays the Admin's own action on /admin/funds (§12.3, REQ-177).

import { formatZar } from "@/lib/format";

export type DormancyBannerItem = {
  code: string;
  displayName: string | null;
  stage: "alert" | "dormant";
  idleDays: number;
  balanceZar: number;
};

/** items: null = the T14 setting is not valid, so dormancy cannot be read. */
export default function DormancyBanner({ items }: { items: DormancyBannerItem[] | null }) {
  if (items === null) {
    return (
      <div role="status" className="mb-4 rounded-[var(--radius-card)] border p-3" style={{ borderColor: "var(--color-warning)" }}>
        <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
          Fund dormancy can&apos;t be checked — the fund settings (T14) are not valid.
        </p>
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <div
      role="alert"
      data-testid="dormancy-banner"
      className="mb-4 rounded-[var(--radius-card)] border p-3"
      style={{
        background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--color-warning) 40%, transparent)",
      }}
    >
      <p className="favo-small" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
        {items.length} blessing fund{items.length === 1 ? "" : "s"} not used for a long time.
      </p>
      <ul className="mt-1 space-y-1">
        {items.map((f) => (
          <li key={f.code} className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
            {f.displayName ?? f.code} ({f.code}): {formatZar(f.balanceZar)}, no movement for {f.idleDays} days —{" "}
            {f.stage === "dormant" ? "dormant: proposed for sweep (an Admin decides)" : "ask the donor"}
          </li>
        ))}
      </ul>
    </div>
  );
}
