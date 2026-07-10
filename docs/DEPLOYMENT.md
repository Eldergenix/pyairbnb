# Cloudflare deployment

## Prerequisites

- Node.js 20 or later
- Wrangler 4
- A least-privilege Cloudflare API token with Workers Scripts edit access

Do not store tokens, global API keys, R2 access keys, or account credentials in
source, `wrangler.jsonc`, `.dev.vars`, shell history, or CI logs.

## Validate and deploy

```bash
npm ci
npm run cf:types
npm run check

export CLOUDFLARE_ACCOUNT_ID='<account-id>'
export CLOUDFLARE_API_TOKEN='<workers-api-token>'
npm run deploy
```

The default is public and read-only, with Cloudflare edge limits of 120 general
requests/minute and 20 flexible searches/minute per caller key and colo. For a
private agent fleet, enable bearer authentication before deploy:

```bash
npx wrangler secret put PYAIRBNB_API_TOKEN
```

Configure the same token as an MCP Authorization header in clients that support
one. Do not place it in an agent prompt or repository file.

## Verification gates

```bash
curl -fsS https://<worker-host>/health
npx wrangler deployments list
```

Then run MCP `initialize`, `tools/list`, `resources/list`, and one
`search_stays` call. Repeat the same call to prove the cache-hit lane and record
both wall-clock times. Verify quote and availability separately; they are
different upstream operations.

Use `npx wrangler tail pyairbnb-mcp` for structured error logs. Deployment,
health, protocol discovery, live search, cache-hit latency, and UI-resource
discovery are separate proof lanes.

## Production hardening

The repository deploys an authless read-only endpoint by default for maximum
MCP client compatibility, with application rate limits already enabled. Before
advertising it broadly, consider OAuth or Cloudflare Access and abuse
monitoring. Cache API behavior changes when Access is in front of a Worker, so
re-run the latency checks after adding it.
