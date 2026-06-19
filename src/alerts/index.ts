import type { Alert, AlertChannel, AlertSendResult, AlertsConfig } from "../types.js";

// Outbound alerting to Slack and Discord. Each service supports two modes:
//   webhook — POST to an incoming-webhook URL (no scopes, simplest)
//   bot     — POST via the chat API with a bot token (API key) + target channel
// Secrets come from config OR env (see config.ts); nothing is committed.

const EMOJI: Record<Alert["level"], string> = { warning: "⚠️", critical: "🚨" };

export function channelLabel(ch: AlertChannel): string {
  return ch.label ? `${ch.type}:${ch.mode} (${ch.label})` : `${ch.type}:${ch.mode}`;
}

/** A channel is usable only if enabled and carrying the credential its mode needs. */
export function channelReady(ch: AlertChannel): boolean {
  if (!ch.enabled) return false;
  if (ch.mode === "webhook") return !!ch.webhookUrl;
  return !!ch.token && !!ch.channel;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
}

async function sendSlack(ch: AlertChannel, alert: Alert): Promise<void> {
  const text = `${EMOJI[alert.level]} *${alert.title}*\n${alert.body}`;
  if (ch.mode === "webhook") {
    const res = await postJson(ch.webhookUrl!, { text });
    if (!res.ok) throw new Error(`slack webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const res = await postJson(
    "https://slack.com/api/chat.postMessage",
    { channel: ch.channel, text },
    { authorization: `Bearer ${ch.token}` },
  );
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!data.ok) throw new Error(`slack api error: ${data.error ?? res.status}`);
}

async function sendDiscord(ch: AlertChannel, alert: Alert): Promise<void> {
  const content = `${EMOJI[alert.level]} **${alert.title}**\n${alert.body}`;
  if (ch.mode === "webhook") {
    const res = await postJson(ch.webhookUrl!, { content });
    // Discord webhooks return 204 No Content on success.
    if (!res.ok) throw new Error(`discord webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }
  const res = await postJson(
    `https://discord.com/api/v10/channels/${ch.channel}/messages`,
    { content },
    { authorization: `Bot ${ch.token}` },
  );
  if (!res.ok) throw new Error(`discord api ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function sendToChannel(ch: AlertChannel, alert: Alert): Promise<void> {
  if (ch.type === "slack") return sendSlack(ch, alert);
  return sendDiscord(ch, alert);
}

/**
 * Fans an alert out to every ready channel, with a per-key cooldown so a failure
 * seen on every monitoring cycle doesn't spam the channel. `now` is injected for
 * testability.
 */
export class AlertManager {
  private lastSent = new Map<string, number>();
  constructor(private cfg: AlertsConfig) {}

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  readyChannels(): AlertChannel[] {
    return this.cfg.channels.filter(channelReady);
  }

  /** Configured channels with creds masked — safe to expose over the API. */
  status() {
    return this.cfg.channels.map((ch) => ({
      label: channelLabel(ch),
      type: ch.type,
      mode: ch.mode,
      enabled: ch.enabled,
      ready: channelReady(ch),
      target: ch.mode === "bot" ? ch.channel ?? null : ch.webhookUrl ? "webhook configured" : null,
    }));
  }

  private onCooldown(key: string, now: number): boolean {
    const last = this.lastSent.get(key);
    return last !== undefined && now - last < this.cfg.cooldownMinutes * 60_000;
  }

  /** Dispatch respecting enable flag + cooldown. Returns [] when suppressed. */
  async dispatch(alert: Alert, now = Date.now()): Promise<AlertSendResult[]> {
    if (!this.cfg.enabled) return [];
    if (this.onCooldown(alert.key, now)) return [];
    this.lastSent.set(alert.key, now);
    return this.fanOut(alert);
  }

  /** Send to every ready channel, ignoring enable/cooldown (used by the test endpoint). */
  async send(alert: Alert): Promise<AlertSendResult[]> {
    return this.fanOut(alert);
  }

  private async fanOut(alert: Alert): Promise<AlertSendResult[]> {
    const channels = this.readyChannels();
    return Promise.all(
      channels.map(async (ch): Promise<AlertSendResult> => {
        try {
          await sendToChannel(ch, alert);
          return { channel: channelLabel(ch), ok: true, detail: "sent" };
        } catch (e) {
          return { channel: channelLabel(ch), ok: false, detail: (e as Error).message };
        }
      }),
    );
  }
}
