import { classifyPublicError } from "../errors.js";
import type {
  ListingCard,
  MultiSearchInput,
  MultiSearchResult,
  SearchResult,
} from "../schemas.js";
import { searchStaysInputSchema } from "../schemas.js";
import { computeFacets } from "./facets.js";
import { searchStays } from "./search.js";
import { sortListings } from "./search-normalize.js";

type QuerySummary = MultiSearchResult["queries"][number];

function perLocationInput(location: string, input: MultiSearchInput) {
  return searchStaysInputSchema.parse({
    location,
    check_in: input.check_in,
    check_out: input.check_out,
    adults: input.adults,
    children: input.children,
    infants: input.infants,
    pets: input.pets,
    price_min: input.price_min,
    price_max: input.price_max,
    room_types: input.room_types,
    amenity_ids: input.amenity_ids,
    property_type_ids: input.property_type_ids,
    free_cancellation: input.free_cancellation,
    instant_book: input.instant_book,
    superhost: input.superhost,
    min_bedrooms: input.min_bedrooms,
    min_rating: input.min_rating,
    currency: input.currency,
    language: input.language,
    sort: input.sort,
    limit: input.per_location_limit,
    require_fresh: input.require_fresh,
    prewarm: false,
    detail_level: input.detail_level,
  });
}

function mergeListings(
  results: SearchResult[],
  limit: number,
  sort: MultiSearchInput["sort"],
): ListingCard[] {
  const byListing = new Map<string, ListingCard>();
  for (const result of results) {
    for (const listing of result.listings) {
      const current = byListing.get(listing.id);
      if (
        !current ||
        (listing.price.total ?? Infinity) < (current.price.total ?? Infinity)
      ) {
        byListing.set(listing.id, listing);
      }
    }
  }
  return sortListings([...byListing.values()], sort).slice(0, limit);
}

export async function multiSearch(
  input: MultiSearchInput,
  ctx: ExecutionContext,
): Promise<MultiSearchResult> {
  const startedAt = performance.now();
  const settled = await Promise.allSettled(
    input.locations.map((location) =>
      searchStays(perLocationInput(location, input), ctx),
    ),
  );
  const successes: SearchResult[] = [];
  const queries: QuerySummary[] = settled.map((result, index) => {
    const label = input.locations[index] ?? "";
    if (result.status === "fulfilled") {
      successes.push(result.value);
      return {
        label,
        total_returned: result.value.total_returned,
        cache: result.value.cache,
        warnings: result.value.warnings,
        error: null,
      };
    }
    return {
      label,
      total_returned: 0,
      cache: "miss",
      warnings: [],
      error: classifyPublicError(result.reason).body.error,
    };
  });
  if (successes.length === 0) {
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw failure?.reason instanceof Error
      ? failure.reason
      : new Error("All location searches failed");
  }
  const listings = mergeListings(successes, input.limit, input.sort);
  const cacheStatuses = [...new Set(successes.map((result) => result.cache))];
  const failures = queries.filter((query) => query.error !== null).length;
  return {
    listings,
    facets: computeFacets(listings, input.currency),
    queries,
    total_returned: listings.length,
    cache: cacheStatuses.length === 1 ? (cacheStatuses[0] ?? "mixed") : "mixed",
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    partial: failures > 0,
    warnings:
      failures > 0
        ? [`${failures} location search(es) failed before the deadline.`]
        : [],
    schema_version: "1.0",
  };
}
