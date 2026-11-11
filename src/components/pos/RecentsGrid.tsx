"use client";

// The POS recents grid — PRD §6.2.1, REQ-050, REQ-052. One tap binds the
// customer. Served tiles (today's cup already claimed) arrive last from the
// server and are visibly marked; they stay tappable, because a served tile is
// "how a barista notices a double claim". On a clean database the grid is
// empty (§6.2.1) and renders nothing — the search field below takes over.

import type { RecentsTile } from "@/server/recents/grid";
import { FREE_CUP_COPY } from "@/server/orders/free-coffee";

const label = (t: RecentsTile) => (t.surname ? `${t.name} ${t.surname}` : t.name);

export default function RecentsGrid({ tiles, onPick }: { tiles: RecentsTile[]; onPick: (t: RecentsTile) => void }) {
  if (tiles.length === 0) return null;
  return (
    <ul aria-label="Recent customers" className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
      {tiles.map((t) => {
        // DEF-F: surname beside the given name. The server sends phoneLast4 only
        // where two tiles read alike (REQ-142); the grid shows what it receives.
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onPick(t)}
              data-served={t.served ? "true" : undefined}
              className={[
                "flex w-full flex-col items-start rounded-[4px] border px-2 py-1.5 min-h-[44px] text-left",
                t.served
                  ? "border-cool-steel/15 bg-coffee-bean/5 opacity-60"
                  : "border-cool-steel/30 hover:bg-coffee-bean/8",
              ].join(" ")}
            >
              <span className="favo-small text-coffee-bean font-semibold">{label(t)}</span>
              {t.phoneLast4 && (
                <span className="favo-caption text-cool-steel tabular-nums">…{t.phoneLast4}</span>
              )}
              {t.served && <span className="favo-caption text-cool-steel">{FREE_CUP_COPY.ENTITLEMENT_USED}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
