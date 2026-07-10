import { createMcpHandler } from "agents/mcp";
import { configureCacheBindings } from "./cache.js";
import { PUBLIC_HEADERS, VERSION } from "./constants.js";
import { errorResponse, handleRest, json, protectRequest } from "./http.js";
import { createMcpServer } from "./mcp.js";

export { compactTextPayload } from "./mcp.js";

const tools = [
  "resolve_location",
  "search_stays",
  "search_flexible_stays",
  "multi_search",
  "compare_listings",
  "get_listing_details",
  "get_listing_reviews",
  "get_host_listings",
  "get_listing_quote",
  "get_listing_availability",
];

function health(): Response {
  return json(
    {
      service: "pyairbnb-mcp",
      version: VERSION,
      status: "ok",
      mcp_endpoint: "/mcp",
      transport: "streamable-http",
      tools,
      latency_target: {
        cached_search: "under 3000ms",
        live_origin: "best effort",
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  configureCacheBindings(env.CACHE_KV, env.METRICS);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
  }
  if (url.pathname === "/" || url.pathname === "/health") return health();

  if (url.pathname === "/mcp" || url.pathname.startsWith("/v1/")) {
    const blocked = await protectRequest(request, url.pathname, env);
    if (blocked) return blocked;
  }
  if (url.pathname === "/mcp") {
    return createMcpHandler(createMcpServer(ctx), {
      enableJsonResponse: true,
    })(request, env, ctx);
  }
  if (url.pathname.startsWith("/v1/")) {
    try {
      return await handleRest(request, url.pathname, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        message: "REST request failed",
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return errorResponse(error);
    }
  }
  return json({ error: "not_found" }, { status: 404 });
}

export default { fetch: route } satisfies ExportedHandler<Env>;
