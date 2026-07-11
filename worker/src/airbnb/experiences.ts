import { readThroughCache } from "../cache.js";
import { RequestError, UpstreamError } from "../errors.js";
import type {
  ExperienceCard,
  ExperiencesResult,
  SearchExperiencesInput,
} from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  EXPERIENCES_OPERATION_ID,
  apiHeaders,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import { resolveLocation } from "./location.js";
import {
  array,
  deepFind,
  number,
  parseDisplayNumber,
  path,
  record,
  string,
} from "./payload.js";
import type { RawParam } from "./types.js";

interface ResolvedPlace {
  placeId: string;
  name: string;
}

function decodeId(value: string): string {
  if (/^\d+$/.test(value)) return value;
  try {
    return atob(value).match(/(\d+)$/)?.[1] ?? value;
  } catch {
    return value;
  }
}

function buildRawParams(
  input: SearchExperiencesInput,
  place: ResolvedPlace,
): RawParam[] {
  const params: RawParam[] = [
    { filterName: "cdnCacheSafe", filterValues: ["false"] },
    { filterName: "datePickerType", filterValues: ["calendar"] },
    { filterName: "federatedSearchSessionId", filterValues: [crypto.randomUUID()] },
    { filterName: "flexibleTripLengths", filterValues: ["one_week"] },
    { filterName: "isOnlineExperiences", filterValues: ["false"] },
    { filterName: "itemsPerGrid", filterValues: [String(input.limit)] },
    { filterName: "location", filterValues: [place.name] },
    { filterName: "placeId", filterValues: [place.placeId] },
    { filterName: "query", filterValues: [place.name] },
    { filterName: "rankMode", filterValues: ["default"] },
    { filterName: "refinementPaths", filterValues: ["/experiences"] },
    { filterName: "screenSize", filterValues: ["large"] },
    { filterName: "searchType", filterValues: ["filter_change"] },
    { filterName: "source", filterValues: ["structured_search_input_header"] },
    { filterName: "tabId", filterValues: ["experience_tab"] },
    { filterName: "version", filterValues: ["1.8.3"] },
  ];
  if (input.check_in && input.check_out) {
    params.push({ filterName: "checkin", filterValues: [input.check_in] });
    params.push({ filterName: "checkout", filterValues: [input.check_out] });
  }
  return params;
}

function extractStartTimes(value: unknown): string[] {
  const times = new Set<string>();
  const scan = (key: string) => {
    const found = deepFind(value, key);
    for (const entry of array(found)) {
      const label = typeof entry === "string" ? entry : string(record(entry)?.title);
      const match = label.match(/\b\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?\b/);
      if (match) times.add(match[0].trim());
    }
    if (typeof found === "string") {
      const match = found.match(/\b\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?\b/);
      if (match) times.add(match[0].trim());
    }
  };
  scan("startTimes");
  scan("displayTimes");
  scan("scheduledTimes");
  scan("availabilityTimes");
  return [...times];
}

function normalizeRatingLabel(label: string): {
  rating: number | null;
  reviewCount: number | null;
} {
  const rating = parseDisplayNumber(label);
  const reviewMatch = label.match(/\(([\d.,]+)\)/);
  const reviewCount = reviewMatch?.[1]
    ? Number(reviewMatch[1].replace(/[,.]/g, ""))
    : null;
  return { rating, reviewCount };
}

function normalizePhoto(value: unknown): string {
  const first = array(value)[0];
  if (typeof first === "string") return first;
  const picture = record(first);
  return (
    string(picture?.poster) ||
    string(picture?.picture) ||
    string(picture?.baseUrl) ||
    string(picture?.url)
  );
}

export function normalizeExperience(value: unknown): ExperienceCard | null {
  const result = record(value);
  if (!result) return null;
  const id = decodeId(string(result.id));
  const title = string(result.title);
  if (!id || !title) return null;

  const displayPrice = record(result.displayPrice);
  const primary = record(displayPrice?.primaryLine);
  const display =
    string(primary?.discountedPrice) ||
    string(primary?.price) ||
    string(primary?.originalPrice);
  const qualifier = string(primary?.qualifier).toLowerCase();
  const { rating, reviewCount } = normalizeRatingLabel(
    string(result.avgRatingLocalized),
  );
  const latitude = number(result.lat);
  const longitude = number(result.lng);

  return {
    id,
    url: `${AIRBNB_ORIGIN}/experiences/${id}`,
    title,
    price: {
      amount: parseDisplayNumber(display),
      currency: string(deepFind(displayPrice, "currency")),
      display,
      per_guest: qualifier.includes("person") || qualifier.includes("guest"),
    },
    rating,
    review_count: reviewCount,
    duration: string(result.kickerText),
    coordinates:
      latitude !== null && longitude !== null
        ? { latitude, longitude }
        : null,
    start_times: extractStartTimes(result),
    categories: array(result.categories)
      .map((item) => (typeof item === "string" ? item : string(record(item)?.title)))
      .filter(Boolean),
    photo: normalizePhoto(result.posterPictures),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function normalizeStartToMinutes(label: string): number | null {
  const match = label.match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function applyTimeFilter(
  experiences: ExperienceCard[],
  input: SearchExperiencesInput,
): { experiences: ExperienceCard[]; warnings: string[] } {
  if (!input.start_time_after && !input.start_time_before) {
    return { experiences, warnings: [] };
  }
  const withTimes = experiences.filter((experience) =>
    experience.start_times.some((time) => normalizeStartToMinutes(time) !== null),
  );
  // The experiences search feed usually omits per-slot start times; they load
  // on the experience page. Rather than drop everything, return the unfiltered
  // set and tell the caller the filter could not be applied here.
  if (withTimes.length === 0) {
    return {
      experiences,
      warnings: [
        "The experiences search feed did not include start times, so start_time_after/start_time_before could not be applied; all matching experiences are returned. Open an experience for its exact schedule.",
      ],
    };
  }
  const after = input.start_time_after ? toMinutes(input.start_time_after) : null;
  const before = input.start_time_before ? toMinutes(input.start_time_before) : null;
  const filtered = withTimes.filter((experience) => {
    const minutes = experience.start_times
      .map(normalizeStartToMinutes)
      .filter((value): value is number => value !== null);
    const earliest = Math.min(...minutes);
    if (after !== null && earliest < after) return false;
    if (before !== null && earliest > before) return false;
    return true;
  });
  return { experiences: filtered, warnings: [] };
}

async function resolvePlace(
  input: SearchExperiencesInput,
  ctx: ExecutionContext,
): Promise<ResolvedPlace> {
  const resolved = await resolveLocation(
    { query: input.location, language: input.language, currency: input.currency, limit: 1 },
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
  return { placeId: candidate.place_id, name: candidate.name };
}

async function loadExperiences(
  input: SearchExperiencesInput,
  place: ResolvedPlace,
  ctx: ExecutionContext,
) {
  const body = {
    operationName: "ExperiencesSearch",
    extensions: {
      persistedQuery: { version: 1, sha256Hash: EXPERIENCES_OPERATION_ID },
    },
    variables: {
      isLeanTreatment: false,
      experiencesSearchRequest: {
        metadataOnly: false,
        rawParams: buildRawParams(input, place),
        searchType: "filter_change",
        source: "structured_search_input_header",
        treatmentFlags: [
          "stays_search_rehydration_treatment_desktop",
          "stays_search_rehydration_treatment_moweb",
          "experiences_search_feed_only_treatment",
        ],
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    },
  };
  const url = new URL(
    `/api/v3/ExperiencesSearch/${EXPERIENCES_OPERATION_ID}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "ExperiencesSearch");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, {
      method: "POST",
      headers: apiHeaders(apiKey),
      body: JSON.stringify(body),
    });
    const results = path(payload, [
      "data",
      "presentation",
      "experiencesSearch",
      "results",
    ]);
    if (!record(results)) {
      throw new UpstreamError(
        "upstream_schema_changed",
        "Airbnb experiences response was incomplete",
      );
    }
    const experiences = array(path(results, ["searchResults"]))
      .map(normalizeExperience)
      .filter((experience): experience is ExperienceCard => experience !== null)
      .slice(0, input.limit);
    return {
      experiences,
      nextCursor:
        string(path(results, ["paginationInfo", "nextPageCursor"])) || null,
    };
  });
}

export async function searchExperiences(
  input: SearchExperiencesInput,
  ctx: ExecutionContext,
): Promise<ExperiencesResult> {
  const startedAt = performance.now();
  const place = await resolvePlace(input, ctx);
  const cached = await readThroughCache({
    namespace: "experiences-search-v1",
    key: {
      ...input,
      require_fresh: undefined,
      start_time_after: undefined,
      start_time_before: undefined,
      resolved_place: place,
    },
    freshTtlSeconds: 10 * 60,
    staleTtlSeconds: 2 * 60 * 60,
    requireFresh: input.require_fresh,
    negativeTtlSeconds: 30,
    ctx,
    load: () => loadExperiences(input, place, ctx),
  });
  const { experiences, warnings } = applyTimeFilter(cached.value.experiences, input);
  return {
    query: {
      location: place.name,
      check_in: input.check_in ?? null,
      check_out: input.check_out ?? null,
      currency: input.currency,
    },
    experiences,
    next_cursor: cached.value.nextCursor,
    total_returned: experiences.length,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    fetched_at: cached.fetchedAt,
    warnings,
    schema_version: "1.0",
  };
}
