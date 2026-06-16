# Cloudflare WAF Rate Limit Rules — AT-83 (G25)
# All three rules use the http_ratelimit phase of the zone ruleset.
# Rate limits are per-IP, sliding 60-second windows.
# Blocked IPs receive a 429 response for the duration of the mitigation timeout.

resource "cloudflare_ruleset" "favo_rate_limits" {
  zone_id     = var.cloudflare_zone_id
  name        = "FAVO rate limits"
  description = "Per-IP rate limits protecting auth, webhooks, and POST endpoints"
  kind        = "zone"
  phase       = "http_ratelimit"

  # ── Rule 1: Auth endpoints ─────────────────────────────────────────────────
  # /api/auth/* processes PIN logins and HOFMI SSO callbacks.
  # 10 req/min/IP prevents brute-force PIN guessing (4-digit PINs have 10,000
  # combinations — 10/min means a full brute-force takes 16+ hours minimum).
  rules {
    action      = "block"
    description = "Auth endpoints: 10 req/min/IP"
    enabled     = true
    expression  = "(http.request.uri.path matches \"^/api/auth/\")"

    ratelimit {
      characteristics        = ["ip.src"]
      period                 = 60
      requests_per_period    = 10
      mitigation_timeout     = 300 # 5-minute block after threshold crossed
    }
  }

  # ── Rule 2: Yoco webhook ───────────────────────────────────────────────────
  # Yoco retry policy can send multiple events per payment (up to ~10 retries).
  # 60 req/min/IP matches Yoco's documented retry budget (R8 in the PRD) while
  # still blocking flood attacks from non-Yoco IPs.
  # Note: Yoco IP allow-listing (Yoco's documented egress CIDRs) is the primary
  # protection here — rate limiting is a defence-in-depth layer.
  rules {
    action      = "block"
    description = "Yoco webhook: 60 req/min/IP"
    enabled     = true
    expression  = "(http.request.uri.path eq \"/api/payments/yoco/webhook\")"

    ratelimit {
      characteristics        = ["ip.src"]
      period                 = 60
      requests_per_period    = 60
      mitigation_timeout     = 60
    }
  }

  # ── Rule 3: POST endpoints overall ────────────────────────────────────────
  # Catch-all 100 req/min/IP on all POST requests. This covers Server Actions,
  # sync endpoint, push subscribe, and any future mutation routes.
  # The auth-specific limit above takes precedence (rules evaluated in order).
  rules {
    action      = "block"
    description = "POST endpoints overall: 100 req/min/IP"
    enabled     = true
    expression  = "(http.request.method eq \"POST\")"

    ratelimit {
      characteristics        = ["ip.src"]
      period                 = 60
      requests_per_period    = 100
      mitigation_timeout     = 60
    }
  }
}
