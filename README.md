# BubblaV Cloudflare Email ingest worker

A Cloudflare Email Worker that forwards raw MIME email to BubblaV's
`/api/cloudflare-email/webhook` endpoint so inbound mail reaches your BubblaV
unified inbox. Replies are sent back out via the Cloudflare Email Sending API
from the BubblaV app.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bubblav-org/cloudflare-email-worker)

## Configuration

Set `BUBBLAV_TOKEN` to the token shown on your BubblaV integration's configure
page. Either edit the `vars` in `wrangler.jsonc` or, preferably, use a secret:

```sh
npx wrangler secret put BUBBLAV_TOKEN
```

Optionally override `BUBBLAV_ENDPOINT` (defaults to
`https://bubblav.com/api/cloudflare-email/webhook`).

## Routing

In the Cloudflare dashboard, go to **Email → Email Routing → Routing Rules**
(or the Email Workers trigger) and route your support address to this worker.
Inbound mail is then POSTed to BubblaV as `message/rfc822` with an
`x-cf-envelope-to` header carrying the envelope recipient.

The BubblaV endpoint accepts two auth transports:

- `?t=<token>` query param plus a matching `Authorization: Bearer <token>`
  header (the same token in both places) — what this worker sends.
- The platform shared-secret path: `Authorization: Bearer <shared secret>` and
  the `cf-<token>@…` address in `x-cf-envelope-to`.

## Retry semantics

- `4xx` responses → `message.setReject(...)` — permanent failure, no retry.
- `5xx` or network errors → throw — the Cloudflare Email Workers platform
  retries delivery.

## Ops note (BubblaV platform)

The platform deployment for `inbound.bubblav.com` reuses this exact worker with
`BUBBLAV_TOKEN` set to the platform's `CLOUDFLARE_EMAIL_INBOUND_SECRET`. That's
an ops step, not code.
