# BubblaV Cloudflare Email ingest worker

A Cloudflare Email Worker that forwards raw MIME email to BubblaV's
`/api/cloudflare-email/webhook` endpoint so inbound mail reaches your BubblaV
unified inbox. Replies are sent back out via the Cloudflare Email Sending API
from the BubblaV app.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bubblav-org/cloudflare-email-worker)

## Configuration

`BUBBLAV_TOKEN` is a Worker **secret**. Never put it in `vars` in
`wrangler.jsonc`. Its value is the token shown on your BubblaV integration's
configure page.

- **Deploy to Cloudflare button**: the deploy form asks for `BUBBLAV_TOKEN`
  (it reads `.dev.vars.example`). Paste the token there.
- **Wrangler CLI**: set the secret, then deploy:

  ```sh
  npx wrangler secret put BUBBLAV_TOKEN
  npx wrangler deploy
  ```

- **Local development** (`wrangler dev`): copy `.dev.vars.example` to
  `.dev.vars` and fill in the token. `.dev.vars` is gitignored.

The worker rejects all mail while the token is not set (or is still the old
`REPLACE_ME` placeholder), with the reason
`BUBBLAV_TOKEN not configured: set it with wrangler secret put BUBBLAV_TOKEN`.

Optionally override `BUBBLAV_ENDPOINT` (defaults to
`https://www.bubblav.com/api/cloudflare-email/webhook`). Use the `www` host —
`bubblav.com` apex 301-redirects to www and the redirect turns the POST into a
GET, which the endpoint rejects with 405.

## Routing

In the Cloudflare dashboard, go to **Email → Email Routing → Routing Rules**
(or the Email Workers trigger) and route your support address to this worker.
Inbound mail is then POSTed to BubblaV as `message/rfc822` with an
`x-cf-envelope-to` header carrying the envelope recipient.

The BubblaV endpoint accepts two auth transports:

- `Authorization: Bearer <token>` — what this worker sends. The token is never
  put in the URL (URLs end up in request logs). Older workers also sent
  `?t=<token>`; the endpoint accepts that only with the same token as Bearer.
- The platform shared-secret path: `Authorization: Bearer <shared secret>` and
  the `cf-<token>@…` address in `x-cf-envelope-to`.

## Retry semantics

- `4xx` responses → `message.setReject(...)` — permanent failure, no retry.
- `5xx` or network errors → throw — the Cloudflare Email Workers platform
  retries delivery.

## Ops note (BubblaV platform)

The platform deployment for `inbound.bubblav.se` reuses this exact worker with
`BUBBLAV_TOKEN` set to the platform's `CLOUDFLARE_EMAIL_INBOUND_SECRET`. That's
an ops step, not code.
