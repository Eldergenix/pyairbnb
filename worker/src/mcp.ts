import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getAvailability,
  getListingQuote,
  resolveLocation,
  searchFlexibleStays,
  searchStays,
} from "./airbnb.js";
import { VERSION } from "./constants.js";
import {
  availabilityInputSchema,
  availabilityResultSchema,
  flexibleResultSchema,
  locationCandidateSchema,
  quoteInputSchema,
  quoteResultSchema,
  resolveLocationInputSchema,
  searchFlexibleStaysInputSchema,
  searchResultSchema,
  searchStaysInputSchema,
} from "./schemas.js";
import { STAYS_WIDGET_HTML, STAYS_WIDGET_URI } from "./widget.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function compactTextPayload(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.listings)) return value;
  const listings = result.listings.map((listing) => {
    if (listing === null || typeof listing !== "object" || Array.isArray(listing)) {
      return listing;
    }
    const card = listing as Record<string, unknown>;
    return {
      id: card.id,
      name: card.name,
      url: card.url,
      price: card.price,
      rating: card.rating,
      review_count: card.review_count,
      guest_favorite: card.guest_favorite,
      check_in: card.check_in,
      check_out: card.check_out,
      nights: card.nights,
    };
  });
  return {
    query: result.query,
    listings,
    next_cursor: result.next_cursor,
    total_returned: result.total_returned,
    cache: result.cache,
    freshness: result.freshness,
    timing_ms: result.timing_ms,
    searched_date_ranges: result.searched_date_ranges,
    sampled: result.sampled,
    partial: result.partial,
    warnings: result.warnings,
    schema_version: result.schema_version,
  };
}

function content(value: unknown): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: JSON.stringify(compactTextPayload(value)) }];
}

function registerWidget(server: McpServer): void {
  registerAppResource(
    server,
    "pyairbnb-stays-widget",
    STAYS_WIDGET_URI,
    {},
    async () => ({
      contents: [{
        uri: STAYS_WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: STAYS_WIDGET_HTML,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: ["https://a0.muscache.com"],
            },
          },
          "openai/widgetDescription":
            "A responsive grid of Airbnb stay cards with photos, total price, dates, and ratings.",
        },
      }],
    }),
  );
}

function registerLocationTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "resolve_location",
    {
      title: "Resolve an Airbnb location",
      description:
        "Resolve a city, neighborhood, landmark, address, region, or country to Airbnb place IDs and map bounds before searching. Use the first candidate unless the request is ambiguous.",
      inputSchema: resolveLocationInputSchema,
      outputSchema: {
        query: z.string(),
        candidates: z.array(locationCandidateSchema),
        cache: z.enum(["hit", "miss", "stale", "bypass"]),
        timing_ms: z.number(),
      },
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await resolveLocation(resolveLocationInputSchema.parse(args), ctx);
      return { structuredContent: result, content: content(result) };
    },
  );
}

function searchToolMeta(invoking: string, invoked: string): Record<string, unknown> {
  return {
    ui: { resourceUri: STAYS_WIDGET_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": STAYS_WIDGET_URI,
    "openai/toolInvocation/invoking": invoking,
    "openai/toolInvocation/invoked": invoked,
  };
}

function registerExactSearchTool(server: McpServer, ctx: ExecutionContext): void {
  registerAppTool(
    server,
    "search_stays",
    {
      title: "Search Airbnb stays",
      description:
        "Fast exact-date Airbnb stay search. Filters location, dates, guests, nightly price, room/property types, amenities, accessibility, cancellation, instant book, superhost, rooms, rating, and sort. Returns compact listing cards and next_cursor. To continue, call search_stays again with cursor set to that exact next_cursor value.",
      inputSchema: searchStaysInputSchema,
      outputSchema: searchResultSchema.shape,
      annotations: readOnlyAnnotations,
      _meta: searchToolMeta("Searching Airbnb stays…", "Airbnb stays ready"),
    },
    async (args) => {
      const result = await searchStays(searchStaysInputSchema.parse(args), ctx);
      return { structuredContent: result, content: content(result) };
    },
  );
}

function registerFlexibleSearchTool(server: McpServer, ctx: ExecutionContext): void {
  registerAppTool(
    server,
    "search_flexible_stays",
    {
      title: "Search flexible Airbnb dates",
      description:
        "Search bounded check-in/day and trip-length combinations concurrently, sample broad windows representatively, deduplicate listings, and return cache/freshness provenance. For stays, day-of-week is meaningful; time-of-day is not.",
      inputSchema: searchFlexibleStaysInputSchema,
      outputSchema: flexibleResultSchema.shape,
      annotations: readOnlyAnnotations,
      _meta: searchToolMeta("Comparing flexible dates…", "Flexible-date stays ready"),
    },
    async (args) => {
      const result = await searchFlexibleStays(
        searchFlexibleStaysInputSchema.parse(args),
        ctx,
      );
      return { structuredContent: result, content: content(result) };
    },
  );
}

function registerQuoteTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "get_listing_quote",
    {
      title: "Get an Airbnb price quote",
      description:
        "Get live availability, total price, nightly average, and fee line items for one listing and an exact date/guest combination.",
      inputSchema: quoteInputSchema,
      outputSchema: quoteResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await getListingQuote(quoteInputSchema.parse(args), ctx);
      return { structuredContent: result, content: content(result) };
    },
  );
}

function registerAvailabilityTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "get_listing_availability",
    {
      title: "Get Airbnb listing availability",
      description:
        "Return a bounded 1-6 month calendar for one listing, including available dates and minimum/maximum-night constraints when Airbnb supplies them.",
      inputSchema: availabilityInputSchema,
      outputSchema: availabilityResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await getAvailability(availabilityInputSchema.parse(args), ctx);
      return { structuredContent: result, content: content(result) };
    },
  );
}

export function createMcpServer(ctx: ExecutionContext): McpServer {
  const server = new McpServer(
    { name: "pyairbnb", version: VERSION },
    {
      instructions:
        "Use resolve_location when a place is ambiguous, then search_stays for exact dates or search_flexible_stays for a bounded date window. Prices in search filters are nightly; results include total and nightly values. Reuse next_cursor with search_stays for another page. Use quote/availability only after selecting listing IDs. All tools are read-only and may return stale cache metadata when Airbnb is slow.",
    },
  );
  registerWidget(server);
  registerLocationTool(server, ctx);
  registerExactSearchTool(server, ctx);
  registerFlexibleSearchTool(server, ctx);
  registerQuoteTool(server, ctx);
  registerAvailabilityTool(server, ctx);
  return server;
}
