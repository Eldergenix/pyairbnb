# UI integrations

Every integration consumes the versioned listing-card JSON returned in MCP
`structuredContent`. The MCP contract stays vendor-neutral; presentation is an
adapter concern.

## React Server Components

Copy `rsc/AirbnbListingGrid.tsx` and `rsc/airbnb-listing-grid.css` into a Next.js App
Router project.
Render it from a server page:

```tsx
<AirbnbListingGrid
  endpoint={process.env.PYAIRBNB_ENDPOINT!}
  query={{
    location: "Tampa, Florida",
    check_in: "2026-07-17",
    check_out: "2026-07-19",
    adults: 2,
    limit: 12,
  }}
/>
```

The component calls the Worker's `/v1/stays/search` endpoint and uses a
five-minute RSC fetch cache. Adjust `revalidate` to match the product's
freshness needs.

## OpenUI Lang

Install `@openuidev/react-lang`, React, and Zod, then copy
`openui/airbnb-library.tsx` and `openui/pyairbnb.css`. It defines one compact
`AirbnbStayResults` component, a complete `PyAirbnbOpenUi` renderer, and a REST
tool-provider factory:

```text
data = Query("search_stays", {location: "Tampa, Florida", check_in: "2026-07-17", check_out: "2026-07-19", adults: 2, currency: "USD", limit: 12}, {listings: []})
root = AirbnbStayResults("Airbnb stays", data.listings)
```

OpenAI/ChatGPT hosts can instead render the built-in MCP Apps resource at
`ui://pyairbnb/stays-v1.html`; both paths use the same tool result.

```tsx
const toolProvider = createPyAirbnbRestToolProvider(process.env.PYAIRBNB_ENDPOINT!);

<PyAirbnbOpenUi
  response={openUiLangFromYourAgent}
  isStreaming={isStreaming}
  toolProvider={toolProvider}
/>
```

If the host already owns an MCP client, pass that client directly as
`toolProvider`; its `callTool({ name, arguments })` method is used by `Query()`.
For a bearer-protected deployment, proxy REST calls through your server or pass
an authenticated MCP client; never embed the bearer token in browser code.
