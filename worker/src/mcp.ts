import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  compareListings,
  getAvailability,
  getHostListings,
  getListingDetails,
  getListingQuote,
  getListingReviews,
  multiSearch,
  resolveLocation,
  searchExperiences,
  searchFlexibleStays,
  searchStays,
} from "./airbnb.js";
import { VERSION } from "./constants.js";
import {
  availabilityInputSchema,
  availabilityResultSchema,
  compareListingsInputSchema,
  compareResultSchema,
  detailsInputSchema,
  detailsResultSchema,
  flexibleResultSchema,
  hostListingsInputSchema,
  hostListingsResultSchema,
  locationCandidateSchema,
  multiSearchInputSchema,
  multiSearchResultSchema,
  quoteInputSchema,
  quoteResultSchema,
  resolveLocationInputSchema,
  reviewsInputSchema,
  reviewsResultSchema,
  searchExperiencesInputSchema,
  searchFlexibleStaysInputSchema,
  searchResultSchema,
  searchStaysInputSchema,
  experiencesResultSchema,
} from "./schemas.js";
import { STAYS_WIDGET_HTML, STAYS_WIDGET_URI } from "./widget.js";

type TextDetail = "compact" | "standard" | "full";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

function compactCard(card: Record<string, unknown>): Record<string, unknown> {
  const price =
    card.price !== null && typeof card.price === "object"
      ? (card.price as Record<string, unknown>)
      : null;
  return {
    id: card.id,
    name: card.name,
    nightly: price?.nightly ?? null,
    total: price?.total ?? null,
    rating: card.rating,
    review_count: card.review_count,
    guest_favorite: card.guest_favorite,
  };
}

function standardCard(card: Record<string, unknown>): Record<string, unknown> {
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
}

/**
 * Trim the text payload the model reads while leaving structuredContent (used
 * by the widget/RSC) canonical. `full` returns the value untouched; `standard`
 * drops per-card media/coordinates; `compact` reduces each card to price and
 * rating. Non-card listing arrays (e.g. comparison rows) are left intact.
 */
export function compactTextPayload(
  value: unknown,
  detail: TextDetail = "standard",
): unknown {
  if (detail === "full") return value;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.listings)) return value;
  const mapCard = detail === "compact" ? compactCard : standardCard;
  const listings = result.listings.map((listing) =>
    listing !== null &&
    typeof listing === "object" &&
    !Array.isArray(listing) &&
    "id" in listing
      ? mapCard(listing as Record<string, unknown>)
      : listing,
  );
  return { ...result, listings };
}

function content(
  value: unknown,
  detail: TextDetail = "full",
): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: JSON.stringify(compactTextPayload(value, detail)) }];
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
      const parsed = searchStaysInputSchema.parse(args);
      const result = await searchStays(parsed, ctx);
      return {
        structuredContent: result,
        content: content(result, parsed.detail_level),
      };
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
      const parsed = searchFlexibleStaysInputSchema.parse(args);
      const result = await searchFlexibleStays(parsed, ctx);
      return {
        structuredContent: result,
        content: content(result, parsed.detail_level),
      };
    },
  );
}

function registerMultiSearchTool(server: McpServer, ctx: ExecutionContext): void {
  registerAppTool(
    server,
    "multi_search",
    {
      title: "Search several Airbnb locations at once",
      description:
        "Search up to five locations concurrently for the same dates and filters, then merge and de-duplicate into one ranked card list with a combined price/rating summary. Use when comparing neighborhoods or cities in a single step instead of calling search_stays repeatedly.",
      inputSchema: multiSearchInputSchema,
      outputSchema: multiSearchResultSchema.shape,
      annotations: readOnlyAnnotations,
      _meta: searchToolMeta("Searching locations…", "Merged stays ready"),
    },
    async (args) => {
      const parsed = multiSearchInputSchema.parse(args);
      const result = await multiSearch(parsed, ctx);
      return {
        structuredContent: result,
        content: content(result, parsed.detail_level),
      };
    },
  );
}

function registerCompareTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "compare_listings",
    {
      title: "Compare Airbnb listings side by side",
      description:
        "Price two to eight specific listings for the same exact dates and guests in one call, returning per-listing availability, total, and nightly price plus the cheapest available option. Use after search to compare shortlisted candidates without separate quote calls.",
      inputSchema: compareListingsInputSchema,
      outputSchema: compareResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await compareListings(
        compareListingsInputSchema.parse(args),
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

function registerExperiencesTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "search_experiences",
    {
      title: "Search Airbnb experiences",
      description:
        "Search bookable Airbnb experiences (activities, tours, classes) for a location, optionally bounded by dates. Unlike overnight stays, experiences are time-of-day based: filter with start_time_after/start_time_before (24-hour HH:MM) to keep only experiences starting in a window. Returns title, price per guest, rating, duration, and any listed start times.",
      inputSchema: searchExperiencesInputSchema,
      outputSchema: experiencesResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await searchExperiences(
        searchExperiencesInputSchema.parse(args),
        ctx,
      );
      return { structuredContent: result, content: content(result) };
    },
  );
}

function registerDetailsTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "get_listing_details",
    {
      title: "Get full Airbnb listing details",
      description:
        "Fetch a listing's title, description, amenities grouped by category, house rules, host, coordinates, and photos. Include check_in and check_out to also return the price line. Use after a search to deeply evaluate one chosen listing.",
      inputSchema: detailsInputSchema,
      outputSchema: detailsResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await getListingDetails(detailsInputSchema.parse(args), ctx);
      return { structuredContent: result, content: content(result) };
    },
  );
}

function registerReviewsTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "get_listing_reviews",
    {
      title: "Get Airbnb listing reviews",
      description:
        "Return recent guest reviews for a listing with reviewer, date, rating, and text, plus any category rating breakdown. Use next_offset to page. Use to summarize guest sentiment for a shortlisted stay.",
      inputSchema: reviewsInputSchema,
      outputSchema: reviewsResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await getListingReviews(reviewsInputSchema.parse(args), ctx);
      return { structuredContent: result, content: content(result) };
    },
  );
}

function registerHostListingsTool(server: McpServer, ctx: ExecutionContext): void {
  server.registerTool(
    "get_host_listings",
    {
      title: "Get a host's other Airbnb listings",
      description:
        "Return the other active listings published by a host (by numeric host_id), with names, cities, ratings, and links. Use to assess a host's portfolio or find alternatives from the same host.",
      inputSchema: hostListingsInputSchema,
      outputSchema: hostListingsResultSchema.shape,
      annotations: readOnlyAnnotations,
    },
    async (args) => {
      const result = await getHostListings(hostListingsInputSchema.parse(args), ctx);
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
        "Use resolve_location when a place is ambiguous, then search_stays for exact dates or search_flexible_stays for a bounded date window. Use multi_search to compare several locations in one call. Every search returns a facets summary (price percentiles, rating, badges) so you can describe the whole set without paginating. Prices in search filters are nightly; results include total and nightly values. Reuse next_cursor with search_stays for another page. After shortlisting, use compare_listings to price several listings together, or get_listing_quote/get_listing_availability for one. Set detail_level to compact to shrink the text payload. All tools are read-only and may return stale cache metadata when Airbnb is slow.",
    },
  );
  registerWidget(server);
  registerLocationTool(server, ctx);
  registerExactSearchTool(server, ctx);
  registerFlexibleSearchTool(server, ctx);
  registerMultiSearchTool(server, ctx);
  registerCompareTool(server, ctx);
  registerExperiencesTool(server, ctx);
  registerDetailsTool(server, ctx);
  registerReviewsTool(server, ctx);
  registerHostListingsTool(server, ctx);
  registerQuoteTool(server, ctx);
  registerAvailabilityTool(server, ctx);
  return server;
}
