# Agent integration guide

## Contract

The remote endpoint is `/mcp` using MCP Streamable HTTP. Each tool has strict
JSON input and output schemas, complete read-only annotations, canonical
`structuredContent`, and a JSON text fallback. This combination is portable
across OpenAI and Anthropic clients.

The server also exposes POST endpoints:

- `/v1/locations/resolve`
- `/v1/stays/search`
- `/v1/stays/flexible`
- `/v1/listings/quote`
- `/v1/listings/availability`

## Recommended agent sequence

1. Resolve only when a location is ambiguous or the application wants reusable
   bounds.
2. Call `search_stays` for exact dates or `search_flexible_stays` for a bounded
   window.
3. Render returned cards immediately.
4. Quote only the user's top one-to-three listings.
5. Read the monthly calendar only for alternate-day or stay-rule questions.
6. Follow `next_cursor` only when more inventory is requested.

Default search output should remain at 12-20 cards. Keep OpenAI's
`mcp_list_tools` item in conversation context, or allowlist only the tools the
workflow needs, to avoid repeated tool import latency.

## Result semantics

- Search price filters are nightly prices.
- Cards include both `price.nightly` and `price.total` when Airbnb supplies a
  display price.
- `cache=hit` is the fastest path.
- `freshness.stale=true` means the service returned prior data and scheduled a
  refresh.
- `partial=true` on flexible search means at least one date combination failed.
- `sampled=true` means the flexible window had more possible combinations than
  the bounded fan-out budget; `searched_date_ranges` is the exact sampled set.
- Flexible results aggregate `cache`, `freshness`, and warnings from successful
  child searches; `cache=mixed` means those child cache lanes differed.
- Search-level review counts can be unknown; strict `min_reviews` excludes
  unknown values and returns a warning when that removes all cards.
- A search page is not the whole market. Say “cheapest returned” unless cursor
  pagination was exhausted.

## UI hosts

The `search_stays` and `search_flexible_stays` tool descriptors point to
`ui://pyairbnb/stays-v1.html`. The resource uses the MCP Apps MIME type
`text/html;profile=mcp-app`, accepts standard `ui/notifications/tool-result`
messages, completes `ui/initialize` / `ui/notifications/initialized`, opens
links through the host bridge, emits size changes, and includes the OpenAI
output-template compatibility alias.

Non-widget clients should map `structuredContent.listings` to their native UI.
Ready, compiled, render-tested adapters live under `integrations/rsc` and
`integrations/openui`. The OpenUI adapter accepts either an MCP client with
`callTool(...)` or a REST-backed function map as its `toolProvider`.

## Error handling

REST validation failures return HTTP 400 with stable codes such as
`invalid_request`; upstream rejection and timeout use 502/503/504. MCP clients
receive standard tool errors from the SDK. Retry a transient origin timeout
once without `require_fresh`; that gives the stale cache lane a chance to
respond. Do not retry invalid schemas.
