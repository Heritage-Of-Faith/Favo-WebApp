#!/usr/bin/env bun
// scripts/ship-ping.ts — AT-85 (G27)
// Posts a structured Discord embed to #favo-ops when FAVO goes live.
//
// Usage:
//   DISCORD_WEBHOOK_URL=<url> bun run scripts/ship-ping.ts \
//     --sha <short-sha> \
//     --smoke pass \
//     --audit 0 \
//     --dashboard https://grafana.hofmi.org/d/favo-ops-v1

import { parseArgs } from "util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    sha:       { type: "string", default: process.env.GITHUB_SHA?.slice(0, 7) ?? "unknown" },
    smoke:     { type: "string", default: "unknown" }, // "pass" | "fail" | "skip"
    audit:     { type: "string", default: "0" },       // gap count from audit-coverage endpoint
    dashboard: { type: "string", default: "" },
    env:       { type: "string", default: "production" },
  },
  strict: false,
  allowPositionals: false,
});

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  console.error("Error: DISCORD_WEBHOOK_URL is not set.");
  process.exit(1);
}

const sha = String(values.sha ?? "unknown");
const smoke = String(values.smoke ?? "unknown");
const auditGap = parseInt(String(values.audit ?? "0"), 10);
const dashboardUrl = String(values.dashboard ?? "");
const env = String(values.env ?? "production");
const timestamp = new Date().toISOString();

// ── Build embed ───────────────────────────────────────────────────────────────

const smokeEmoji = smoke === "pass" ? "✅" : smoke === "fail" ? "❌" : "⚠️";
const auditEmoji = auditGap === 0 ? "✅" : "🚨";
const overallColour = smoke === "pass" && auditGap === 0 ? 0x00c851 : 0xff4444;
const overallTitle =
  smoke === "pass" && auditGap === 0
    ? "🟢 FAVO is live!"
    : "🔴 FAVO deploy — issues detected";

const fields: Array<{ name: string; value: string; inline: boolean }> = [
  { name: "Environment", value: env, inline: true },
  { name: "Deploy SHA", value: `\`${sha}\``, inline: true },
  { name: "Deployed at", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
  { name: `${smokeEmoji} Prod smoke`, value: smoke === "pass" ? "All tests pass" : `FAILED — ${smoke}`, inline: true },
  { name: `${auditEmoji} Audit coverage`, value: auditGap === 0 ? "Gap = 0 ✓" : `GAP = ${auditGap} ⚠️ INVESTIGATE`, inline: true },
];

if (dashboardUrl) {
  fields.push({
    name: "📊 Grafana",
    value: `[Open ops dashboard](${dashboardUrl})`,
    inline: false,
  });
}

const embed = {
  title: overallTitle,
  color: overallColour,
  description:
    smoke === "pass" && auditGap === 0
      ? "FAVO Café is live at **https://favo.hofmi.org** — all gates green."
      : "Deploy completed but some gates failed. Check fields below.",
  fields,
  footer: { text: "FAVO Café — shipped via Claude Code" },
  timestamp,
};

const payload = {
  username: "FAVO Deploy Bot",
  avatar_url: "https://favo.hofmi.org/icon.png",
  embeds: [embed],
};

// ── Post to Discord ───────────────────────────────────────────────────────────

const res = await fetch(webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`Discord webhook failed: HTTP ${res.status}\n${body}`);
  process.exit(1);
}

console.log(`Ship ping sent ✓ (smoke: ${smoke}, audit gap: ${auditGap}, sha: ${sha})`);
