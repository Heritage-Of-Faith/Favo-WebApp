// Discord webhook helper — task G14
// Sends embed-formatted messages to the #favo-ops channel.
// Uses DISCORD_WEBHOOK_FAVO_OPS env var.
// Docs: FAVO_PRD_v3.md §07 §09 (Phase 2 acceptance — Discord ping)

export type DiscordField = {
  name: string;
  value: string;
  inline?: boolean;
};

export type PingOptions = {
  title: string;
  description?: string;
  color?: number; // Discord hex colour int (e.g. 0x2ecc71 = green)
  fields?: DiscordField[];
};

/** Sends one embed to the favo-ops Discord channel. Non-throwing — logs errors. */
export async function pingFavoOps(opts: PingOptions): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_FAVO_OPS;
  if (!webhookUrl) {
    console.warn("[discord] DISCORD_WEBHOOK_FAVO_OPS not set — skipping ping.");
    return;
  }

  const body = JSON.stringify({
    embeds: [
      {
        title: opts.title,
        description: opts.description,
        color: opts.color ?? 0x6f4e37, // FAVO coffee-brown default
        fields: opts.fields ?? [],
        footer: { text: "FAVO Café · favo.hofmi.org" },
      },
    ],
  });

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      console.error(`[discord] Webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.error("[discord] Failed to send webhook:", err);
  }
}

// ─── Pure helpers (unit-testable) ─────────────────────────────────────────────

/** Formats integer ZAR cents as a Discord-friendly string: R 1 234,56 */
export function formatZarField(cents: number): string {
  const rand = cents / 100;
  return `R ${rand.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Returns a colour int based on whether net P&L is positive or negative. */
export function pnlColor(netZar: number): number {
  return netZar >= 0 ? 0x2ecc71 : 0xe74c3c; // green / red
}
