variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:Edit + Access:Edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for favo.hofmi.org"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID (hofmi)"
  type        = string
}

variable "domain" {
  description = "Production domain"
  type        = string
  default     = "favo.hofmi.org"
}

variable "hofmi_sso_team_domain" {
  description = "Cloudflare Access team domain (e.g. hofmi.cloudflareaccess.com)"
  type        = string
  default     = "hofmi.cloudflareaccess.com"
}
