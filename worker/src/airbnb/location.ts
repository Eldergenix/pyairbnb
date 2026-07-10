import { readThroughCache } from "../cache.js";
import { RequestError } from "../errors.js";
import type {
  LocationCandidate,
  ResolveLocationInput,
  SearchStaysInput,
} from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  apiHeaders,
  fetchJson,
  getMarket,
  withApiKeyRetry,
} from "./client.js";
import { array, number, path, record, string } from "./payload.js";
import type { ResolvedSearchLocation } from "./types.js";

function normalizeCandidate(value: unknown): LocationCandidate | null {
  const candidate = record(value);
  const location = record(candidate?.location);
  const rawBounds = record(location?.bounding_box);
  const placeId =
    string(path(candidate, ["explore_search_params", "place_id"])) ||
    string(location?.google_place_id);
  const bounds = {
    northeast_latitude: number(rawBounds?.ne_lat),
    northeast_longitude: number(rawBounds?.ne_lng),
    southwest_latitude: number(rawBounds?.sw_lat),
    southwest_longitude: number(rawBounds?.sw_lng),
  };
  if (
    !placeId ||
    bounds.northeast_latitude === null ||
    bounds.northeast_longitude === null ||
    bounds.southwest_latitude === null ||
    bounds.southwest_longitude === null
  ) {
    return null;
  }
  return {
    name:
      string(location?.location_name) ||
      string(path(candidate, ["explore_search_params", "query"])),
    display_name: string(candidate?.display_name),
    place_id: placeId,
    country_code: string(location?.country_code),
    types: array(location?.types).map(string).filter(Boolean),
    bounds: {
      northeast_latitude: bounds.northeast_latitude,
      northeast_longitude: bounds.northeast_longitude,
      southwest_latitude: bounds.southwest_latitude,
      southwest_longitude: bounds.southwest_longitude,
    },
  };
}

async function loadCandidates(
  input: ResolveLocationInput,
  ctx: ExecutionContext,
): Promise<LocationCandidate[]> {
  return withApiKeyRetry(ctx, async (apiKey) => {
    const market = await getMarket(apiKey, input.language, input.currency, ctx);
    const url = new URL("/api/v2/autocompletes-personalized", AIRBNB_ORIGIN);
    const params: Record<string, string> = {
      currency: input.currency,
      country: input.country_code ?? market.countryCode,
      key: apiKey,
      language: input.language,
      locale: input.language,
      num_results: String(input.limit),
      user_input: input.query,
      api_version: "1.2.0",
      satori_config_token: market.satoriToken,
      vertical_refinement: "homes",
      region: "-1",
      options:
        "should_filter_by_vertical_refinement|hide_nav_results|" +
        "should_show_stays|simple_search",
    };
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
    return array(path(payload, ["autocomplete_terms"]))
      .map(normalizeCandidate)
      .filter((candidate): candidate is LocationCandidate => candidate !== null)
      .slice(0, input.limit);
  });
}

export async function resolveLocation(
  input: ResolveLocationInput,
  ctx: ExecutionContext,
): Promise<{
  query: string;
  candidates: LocationCandidate[];
  cache: "hit" | "miss" | "stale" | "bypass";
  timing_ms: number;
}> {
  const startedAt = performance.now();
  const cached = await readThroughCache({
    namespace: "airbnb-location-v2",
    key: input,
    freshTtlSeconds: 24 * 60 * 60,
    staleTtlSeconds: 7 * 24 * 60 * 60,
    requireFresh: false,
    ctx,
    load: () => loadCandidates(input, ctx),
  });
  return {
    query: input.query,
    candidates: cached.value,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
  };
}

export async function resolveSearchLocation(
  input: SearchStaysInput,
  ctx: ExecutionContext,
): Promise<ResolvedSearchLocation> {
  if (input.bounds || input.place_id) {
    return {
      label: input.location ?? "Map area",
      placeId: input.place_id,
      bounds: input.bounds,
    };
  }
  if (!input.location) {
    throw new RequestError(
      "missing_location",
      "Provide location, place_id, or bounds",
    );
  }
  const resolved = await resolveLocation(
    {
      query: input.location,
      language: input.language,
      currency: input.currency,
      limit: 1,
    },
    ctx,
  );
  const candidate = resolved.candidates[0];
  if (!candidate) {
    throw new RequestError(
      "location_not_found",
      `No Airbnb location matched '${input.location}'`,
      422,
    );
  }
  return {
    label: candidate.name,
    placeId: candidate.place_id,
    bounds: candidate.bounds,
  };
}
