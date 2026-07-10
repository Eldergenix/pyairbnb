import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import type { HostListingsInput, HostListingsResult } from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  HOST_LISTINGS_OPERATION_ID,
  apiHeaders,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import { array, number, path, record, string } from "./payload.js";

type HostListingRow = HostListingsResult["listings"][number];

function normalizeHostListing(value: unknown): HostListingRow | null {
  const listing = record(value);
  if (!listing) return null;
  const id = string(listing.id) || String(number(listing.id) ?? "");
  if (!id) return null;
  const picture =
    string(listing.pictureUrl) ||
    string(array(listing.pictureUrls)[0]) ||
    string(path(listing, ["contextualPictures", "0", "picture"]));
  return {
    id,
    name: string(listing.name) || string(listing.title) || `Airbnb stay ${id}`,
    url: `${AIRBNB_ORIGIN}/rooms/${id}`,
    city: string(listing.city) || string(listing.localizedCity),
    rating: number(listing.avgRating) ?? number(listing.starRating),
    review_count: number(listing.reviewsCount) ?? number(listing.reviewCount),
    picture,
  };
}

async function loadHostListings(input: HostListingsInput, ctx: ExecutionContext) {
  const variables = {
    userId: Number(input.host_id),
    limit: input.limit,
    offset: 0,
  };
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: HOST_LISTINGS_OPERATION_ID },
  };
  const url = new URL(
    `/api/v3/UserProfileBeehiveListingQuery/${HOST_LISTINGS_OPERATION_ID}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "UserProfileBeehiveListingQuery");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify(extensions));
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
    if (array(path(payload, ["errors"])).length > 0) {
      throw new UpstreamError(
        "upstream_graphql_error",
        "Airbnb host listings response included errors",
      );
    }
    const listings = path(payload, [
      "data",
      "beehive",
      "getListOfListings",
      "listings",
    ]);
    if (!Array.isArray(listings)) {
      throw new UpstreamError(
        "upstream_schema_changed",
        "Airbnb host listings response was incomplete",
      );
    }
    return listings
      .map(normalizeHostListing)
      .filter((listing): listing is HostListingRow => listing !== null);
  });
}

export async function getHostListings(
  input: HostListingsInput,
  ctx: ExecutionContext,
): Promise<HostListingsResult> {
  const startedAt = performance.now();
  const cached = await readThroughCache({
    namespace: "host-listings-v1",
    key: { ...input, require_fresh: undefined },
    freshTtlSeconds: 30 * 60,
    staleTtlSeconds: 6 * 60 * 60,
    requireFresh: input.require_fresh,
    negativeTtlSeconds: 30,
    ctx,
    load: () => loadHostListings(input, ctx),
  });
  return {
    host_id: input.host_id,
    listings: cached.value,
    returned: cached.value.length,
    next_offset: cached.value.length >= input.limit ? input.limit : null,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    fetched_at: cached.fetchedAt,
    schema_version: "1.0",
  };
}
