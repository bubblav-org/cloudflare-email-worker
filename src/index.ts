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
  /** Envelope sender (MAIL FROM). */
  from?: string;
  setReject(reason: string): void;
}

/** Minimal local ExportedHandler so `satisfies` works without @cloudflare/workers-types. */
interface ExportedHandler<E extends Env = Env> {
  email?(message: ForwardableEmailMessage, env: E, ctx: unknown): void | Promise<void>;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, _ctx: unknown): Promise<void> {
    // Never log secret VALUES — presence/length only.
    const tokenSet = Boolean(env.BUBBLAV_TOKEN && env.BUBBLAV_TOKEN !== 'REPLACE_ME');
    console.log(
      `[ingest] to=${message.to} rawFrom=${message.from ?? '?'} ` +
      `env: BUBBLAV_TOKEN=${tokenSet ? `set(${env.BUBBLAV_TOKEN.length})` : 'MISSING'} ` +
      `BUBBLAV_ENDPOINT=${env.BUBBLAV_ENDPOINT ?? 'MISSING'}`
    );

    // A Deploy-button install that never overrode the template token would
    // otherwise get 401 → setReject forever. Reject loudly instead.
    if (!tokenSet) {
      console.error('[ingest] BUBBLAV_TOKEN missing — rejecting before POST');
      message.setReject('BUBBLAV_TOKEN not configured — set it via wrangler secret put or wrangler.jsonc vars');
      return;
    }
    if (!env.BUBBLAV_ENDPOINT) {
      console.error('[ingest] BUBBLAV_ENDPOINT missing — rejecting');
      message.setReject('BUBBLAV_ENDPOINT not configured');
      return;
    }

    // `message.raw` is a single-use stream — buffer it once so the body can be
    // sent as the POST body without consuming it twice.
    const raw = await new Response(message.raw).arrayBuffer();
    console.log(`[ingest] buffered ${raw.byteLength} bytes`);

    // Auth: BubblaV accepts `?t=<token>` + a matching `Authorization: Bearer`
    // header (same token, dual transport). If the endpoint already carries a
    // query string, pass it through untouched.
    const url = env.BUBBLAV_ENDPOINT.includes('?')
      ? env.BUBBLAV_ENDPOINT
      : `${env.BUBBLAV_ENDPOINT}?t=${env.BUBBLAV_TOKEN}`;
    console.log(`[ingest] POST ${env.BUBBLAV_ENDPOINT}`);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'message/rfc822',
          'authorization': `Bearer ${env.BUBBLAV_TOKEN}`,
          'x-cf-envelope-to': message.to,
        },
        body: raw,
      });
    } catch (err) {
      console.error('[ingest] fetch threw:', err);
      throw err; // retry via platform
    }

    const body = await res.text().catch(() => '');
    console.log(`[ingest] response ${res.status} body=${body.slice(0, 300)}`);

    // 4xx = permanent rejection (bad token/tenant) — no retry.
    if (res.status >= 400 && res.status < 500) {
      console.error(`[ingest] 4xx ${res.status} — setReject`);
      message.setReject(`BubblaV ingest rejected: HTTP ${res.status}`);
      return;
    }

    // 5xx / network failure — throw so the Email Workers platform retries.
    if (!res.ok) {
      console.error(`[ingest] 5xx ${res.status} — throwing for retry`);
      throw new Error(`Bubblav ingest failed: ${res.status}`);
    }
    console.log('[ingest] delivered ok');
  },
} satisfies ExportedHandler<Env>;
