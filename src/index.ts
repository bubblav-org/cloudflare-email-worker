/**
 * BubblaV Cloudflare Email ingest worker.
 *
 * Forwards raw MIME email received by a Cloudflare Email Worker to BubblaV's
 * `/api/cloudflare-email/webhook` endpoint so inbound mail reaches the unified
 * BubblaV inbox (replies are sent back via the Cloudflare Email Sending API).
 *
 * This template is intentionally dependency-free: it has no build step and no
 * npm packages, so the minimal Cloudflare Workers types are declared locally
 * below instead of importing @cloudflare/workers-types.
 */

interface Env {
  BUBBLAV_ENDPOINT: string;
  BUBBLAV_TOKEN: string;
}

/** Minimal local shape of ForwardableEmailMessage (keeps the template dependency-free). */
interface ForwardableEmailMessage {
  raw: ReadableStream;
  to: string;
  setReject(reason: string): void;
}

/** Minimal local ExportedHandler so `satisfies` works without @cloudflare/workers-types. */
interface ExportedHandler<E extends Env = Env> {
  email?(message: ForwardableEmailMessage, env: E, ctx: unknown): void | Promise<void>;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: unknown): Promise<void> {
    // A Deploy-button install that never overrode the template token would
    // otherwise get 401 → setReject forever. Reject loudly instead.
    if (!env.BUBBLAV_TOKEN || env.BUBBLAV_TOKEN === 'REPLACE_ME') {
      message.setReject('BUBBLAV_TOKEN not configured — set it via wrangler secret put or wrangler.jsonc vars');
      return;
    }
    // `message.raw` is a single-use stream — buffer it once so the body can be
    // sent as the POST body without consuming it twice.
    const raw = await new Response(message.raw).arrayBuffer();
    // Auth: BubblaV accepts `?t=<token>` + a matching `Authorization: Bearer`
    // header (same token, dual transport). If the endpoint already carries a
    // query string, pass it through untouched.
    const url =
      env.BUBBLAV_TOKEN && env.BUBBLAV_ENDPOINT.includes('?')
        ? env.BUBBLAV_ENDPOINT
        : `${env.BUBBLAV_ENDPOINT}?t=${env.BUBBLAV_TOKEN}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'message/rfc822',
        'authorization': `Bearer ${env.BUBBLAV_TOKEN}`,
        'x-cf-envelope-to': message.to,
      },
      body: raw,
    });

    // 4xx = permanent rejection (bad token/tenant) — no retry.
    if (res.status >= 400 && res.status < 500) {
      message.setReject('BubblaV ingest rejected');
      return;
    }

    // 5xx / network failure — throw so the Email Workers platform retries.
    if (!res.ok) {
      throw new Error(`BubblaV ingest failed: ${res.status}`);
    }
  },
} satisfies ExportedHandler<Env>;
