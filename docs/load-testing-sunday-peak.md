# SC02 — Sunday-peak load test (45 orders / 85 minutes)

PRD §04 SC02 · §11 P2 manual drill. **Target:** 45 orders processed in the
07:50–09:15 window without queue degradation; the POS queue board stays stable.
**Pass:** p95 order-create latency stable (no runaway growth), zero 5xx, live
queue (SSE) keeps delivering `state_change` frames, and all 45 orders land in the
DB. This is a **staging** drill — it must NOT run against production data.

This artifact is intentionally NOT wired into CI (it needs a deployed target +
a barista session). Run it by hand against staging as part of graduation.

## Prerequisites
- Staging URL (e.g. a Vercel preview or `favo-web-app.vercel.app` staging), with
  Yoco in **test** mode so no real cards are charged.
- A barista session cookie (log in once via the POS PIN screen, copy the
  Auth.js session cookie) OR a seeded barista PIN for the login step.
- [`k6`](https://k6.io) installed locally (`brew install k6`).

## Scenario (k6)
Save as `sunday-peak.js`, then:
`BASE_URL=https://<staging> SESSION_COOKIE='<cookie>' k6 run sunday-peak.js`

```javascript
import http from "k6/http";
import { check } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL;
const COOKIE = __ENV.SESSION_COOKIE;

const createLatency = new Trend("order_create_ms", true);
const errorRate = new Rate("order_errors");

export const options = {
  // 45 orders spread across the peak, ramped so concurrency mimics a real rush.
  scenarios: {
    sunday_rush: { executor: "per-vu-iterations", vus: 15, iterations: 3, maxDuration: "10m" },
  },
  thresholds: {
    // Queue must not degrade: p95 create latency stable and low; near-zero errors.
    order_create_ms: ["p(95)<2000"],
    order_errors: ["rate<0.01"],
  },
};

// NOTE: createOrder is a Next.js Server Action, not a plain REST endpoint.
// Drive it the way the POS does — either (a) POST to the server-action endpoint
// with the correct Next-Action headers captured from a real POS request in
// DevTools, or (b) replace this with a Playwright script that opens N POS tabs
// and places an order in each. Fill in the request below from a captured POS call.
export default function () {
  const res = http.post(
    `${BASE}/pos`,
    /* body captured from a real "place order" Server Action request */ null,
    { headers: { Cookie: COOKIE, "Next-Action": "<action-id-from-devtools>" } }
  );
  createLatency.add(res.timings.duration);
  errorRate.add(res.status >= 400);
  check(res, { "order accepted": (r) => r.status < 400 });
}
```

## While it runs
- Watch the POS queue board on a real tablet/browser: `state_change` frames
  should keep arriving; on any reconnect the board must re-populate (F8 / R9).
- After the run: `SELECT COUNT(*) FROM orders WHERE placed_at > now() - interval '90 min';`
  must equal the number sent, and
  `SELECT * FROM v_order_fulfillment_percentiles WHERE sast_date = current_date;`
  gives the p50/p95 order-to-cup minutes for SC03/SC04.

## Alternative: Playwright
If you prefer browser-fidelity over raw HTTP, script `test.describe.parallel`
with 15 contexts × 3 orders each through the real POS UI. Slower but exercises
the full SSE + payment path end to end.
