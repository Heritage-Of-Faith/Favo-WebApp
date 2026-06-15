terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# ── HOFMI SSO Identity Provider ───────────────────────────────────────────────
# Cloudflare Access delegates authentication to HOFMI's existing SSO (SAML/OIDC).
# This resource references the IdP already configured in the Cloudflare dashboard;
# import its ID into state rather than re-creating it:
#   terraform import cloudflare_access_identity_provider.hofmi_sso <account_id>/<idp_id>

data "cloudflare_access_identity_provider" "hofmi_sso" {
  account_id = var.cloudflare_account_id
  name       = "HOFMI SSO"
}

# ── Access Application: /admin/* ──────────────────────────────────────────────
# Requires an authenticated HOFMI SSO session for all paths under /admin/.
# Customers, POS (/pos), and the landing page (/) remain publicly accessible.

resource "cloudflare_access_application" "favo_admin" {
  account_id       = var.cloudflare_account_id
  name             = "FAVO Admin"
  domain           = "${var.domain}/admin"
  type             = "self_hosted"
  session_duration = "8h"

  # Redirect unauthenticated users straight to SSO (no Cloudflare login page)
  auto_redirect_to_identity = true

  allowed_idps = [data.cloudflare_access_identity_provider.hofmi_sso.id]

  # CORS is not needed — admin is server-rendered, no cross-origin API calls
  cors_headers = []
}

resource "cloudflare_access_policy" "favo_admin_allow" {
  application_id = cloudflare_access_application.favo_admin.id
  account_id     = var.cloudflare_account_id
  name           = "HOFMI staff"
  precedence     = 1
  decision       = "allow"

  include {
    login_method = [data.cloudflare_access_identity_provider.hofmi_sso.id]
  }
}

# ── Access Application: /finance/* ───────────────────────────────────────────
# Finance paths are gated to owner + finance roles only.
# Uses the same HOFMI SSO IdP; role enforcement happens in the Next.js RBAC
# middleware (cloudflare_access_application only gates to authenticated users).

resource "cloudflare_access_application" "favo_finance" {
  account_id       = var.cloudflare_account_id
  name             = "FAVO Finance"
  domain           = "${var.domain}/finance"
  type             = "self_hosted"
  session_duration = "8h"

  auto_redirect_to_identity = true
  allowed_idps               = [data.cloudflare_access_identity_provider.hofmi_sso.id]
  cors_headers               = []
}

resource "cloudflare_access_policy" "favo_finance_allow" {
  application_id = cloudflare_access_application.favo_finance.id
  account_id     = var.cloudflare_account_id
  name           = "HOFMI staff"
  precedence     = 1
  decision       = "allow"

  include {
    login_method = [data.cloudflare_access_identity_provider.hofmi_sso.id]
  }
}
