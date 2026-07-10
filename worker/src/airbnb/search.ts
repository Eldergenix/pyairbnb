import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import type {
  ListingCard,
  SearchResult,
  SearchStaysInput,
} from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  SEARCH_OPERATION_ID,
  apiHeaders,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import { computeFacets } from "./facets.js";
import { resolveSearchLocation } from "./location.js";
import { array, path, record, string } from "./payload.js";
import {
  hasPersistedQueryError,
  refreshStaysSearchOperationId,
} from "./operation-id.js";
import { prewarmTopQuotes } from "./prewarm.js";
import {
  appliedFilters,
  buildSearchFilters,
  validateDateRange,
} from "./search-filters.js";
import { normalizeListing, sortListings } from "./search-normalize.js";
import type { ResolvedSearchLocation, SearchPage } from "./types.js";

function buildSearchRequest(
  input: SearchStaysInput,
  location: ResolvedSearchLocation,
  operationId: string,
): Record<string, unknown> {
  return {
    operationName: "StaysSearch",
    extensions: {
      persistedQuery: { version: 1, sha256Hash: operationId },
    },
    variables: {
      skipExtendedSearchParams: false,
      includeMapResults: false,
      isLeanTreatment: true,
      aiSearchEnabled: false,
      staysSearchRequest: {
        cursor: input.cursor ?? "",
        maxMapItems: 0,
        requestedPageType: "STAYS_SEARCH",
        metadataOnly: false,
        source: "structured_search_input_header",
        searchType: input.cursor ? "pagination" : "user_map_move",
        treatmentFlags: [],
        rawParams: buildSearchFilters(input, location),
      },
    },
  };
}

function filterAndSortListings(
  rawListings: unknown[],
  input: SearchStaysInput,
  nights: number,
): ListingCard[] {
  const listings = rawListings
    .map((listing) => normalizeListing(listing, input, nights))
    .filter((listing): listing is ListingCard => listing !== null)
    .filter(
      (listing) =>
        (input.min_rating <= 0 || (listing.rating ?? 0) >= input.min_rating) &&
        (input.min_reviews <= 0 ||
          (listing.review_count ?? 0) >= input.min_reviews),
    );
  return sortListings(listings, input.sort).slice(0, input.limit);
}

function parseSearchPage(
  payload: unknown,
  input: SearchStaysInput,
  location: ResolvedSearchLocation,
): SearchPage {
  const results = path(payload, [
    "data",
    "presentation",
    "staysSearch",
    "results",
  ]);
  if (!record(results)) {
    const errors = array(path(payload, ["errors"]));
    throw new UpstreamError(
      "upstream_schema_changed",
      `Airbnb search response was incomplete${errors.length ? " and included errors" : ""}`,
    );
  }
  const nights = validateDateRange(input.check_in, input.check_out);
  const listings = filterAndSortListings(
    array(path(results, ["searchResults"])),
    input,
    nights,
  );
  const warnings: string[] = [];
  if (input.min_reviews > 0 && listings.length === 0) {
    warnings.push(
      "Airbnb may omit review counts in search; strict min_reviews filtering removed unknown values.",
    );
  }
  return {
    listings,
    nextCursor:
      string(path(results, ["paginationInfo", "nextPageCursor"])) || null,
    filtersApplied: appliedFilters(input),
    locationLabel: location.label,
    warnings,
  };
}

async function loadSearchPage(
  input: SearchStaysInput,
  location: ResolvedSearchLocation,
  ctx: ExecutionContext,
): Promise<SearchPage> {
  let operationId = SEARCH_OPERATION_ID;
  let payload = await requestSearchPage(input, location, operationId, ctx);
  if (hasPersistedQueryError(payload)) {
    operationId = await refreshStaysSearchOperationId(ctx);
    payload = await requestSearchPage(input, location, operationId, ctx);
  }
  return parseSearchPage(payload, input, location);
}

async function requestSearchPage(
  input: SearchStaysInput,
  location: ResolvedSearchLocation,
  operationId: string,
  ctx: ExecutionContext,
): Promise<unknown> {
  const url = new URL(
    `/api/v3/StaysSearch/${operationId}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "StaysSearch");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, {
      method: "POST",
      headers: apiHeaders(apiKey),
      body: JSON.stringify(buildSearchRequest(input, location, operationId)),
    });
    return payload;
  });
}

export async function searchStays(
  input: SearchStaysInput,
  ctx: ExecutionContext,
): Promise<SearchResult> {
  const startedAt = performance.now();
  validateDateRange(input.check_in, input.check_out);
  const location = await resolveSearchLocation(input, ctx);
  const cacheKey = {
    ...input,
    require_fresh: undefined,
    detail_level: undefined,
    prewarm: undefined,
    resolved_location: location,
  };
  const cached = await readThroughCache({
    namespace: "stays-search-v4",
    key: cacheKey,
    freshTtlSeconds: 5 * 60,
    staleTtlSeconds: 60 * 60,
    requireFresh: input.require_fresh,
    negativeTtlSeconds: 30,
    ctx,
    load: () => loadSearchPage(input, location, ctx),
  });
  const listings = cached.value.listings;
  if (input.prewarm && cached.status !== "hit") {
    prewarmTopQuotes(listings, input, ctx);
  }
  return {
    query: {
      location: cached.value.locationLabel,
      check_in: input.check_in,
      check_out: input.check_out,
      currency: input.currency,
    },
    listings,
    facets: computeFacets(listings, input.currency),
    next_cursor: cached.value.nextCursor,
    total_returned: listings.length,
    cache: cached.status,
    freshness: {
      fetched_at: cached.fetchedAt,
      age_seconds: Math.round(cached.ageSeconds * 10) / 10,
      stale: cached.stale,
    },
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    filters_applied: cached.value.filtersApplied,
    warnings: cached.value.warnings,
    schema_version: "1.0",
  };
}
