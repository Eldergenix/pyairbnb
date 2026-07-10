import { RequestError } from "../errors.js";
import type {
  FlexibleResult,
  ListingCard,
  SearchFlexibleStaysInput,
  SearchResult,
  SearchStaysInput,
} from "../schemas.js";
import { resolveSearchLocation } from "./location.js";
import { searchStays } from "./search.js";
import { sortListings } from "./search-normalize.js";

interface DateRange {
  check_in: string;
  check_out: string;
}

function parseFlexibleWindow(input: SearchFlexibleStaysInput): {
  first: number;
  last: number;
} {
  const first = Date.parse(`${input.earliest_check_in}T00:00:00Z`);
  const last = Date.parse(`${input.latest_check_in}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) {
    throw new RequestError(
      "invalid_date_window",
      "latest_check_in must be on or after earliest_check_in",
    );
  }
  if ((last - first) / 86_400_000 > 180) {
    throw new RequestError(
      "date_window_too_large",
      "Flexible date windows are limited to 180 days",
    );
  }
  return { first, last };
}

function eligibleDates(
  first: number,
  last: number,
  allowedDays: Set<number>,
): Date[] {
  const dates: Date[] = [];
  for (let timestamp = first; timestamp <= last; timestamp += 86_400_000) {
    const date = new Date(timestamp);
    if (allowedDays.size > 0 && !allowedDays.has(date.getUTCDay())) continue;
    dates.push(date);
  }
  if (dates.length === 0) {
    throw new RequestError(
      "no_matching_dates",
      "No dates matched the requested weekday filters",
    );
  }
  return dates;
}

function toRange(date: Date, nights: number): DateRange {
  return {
    check_in: date.toISOString().slice(0, 10),
    check_out: new Date(date.getTime() + nights * 86_400_000)
      .toISOString()
      .slice(0, 10),
  };
}

function sampleRanges(
  dates: Date[],
  nights: number[],
  allRanges: DateRange[],
  limit: number,
): DateRange[] {
  const selected: DateRange[] = [];
  const selectedKeys = new Set<string>();
  for (let index = 0; index < limit; index += 1) {
    const dateIndex =
      limit === 1 ? 0 : Math.round((index * (dates.length - 1)) / (limit - 1));
    const nightCount = nights[index % nights.length] ?? nights[0];
    const date = dates[dateIndex] ?? dates[0];
    if (!date || nightCount === undefined) continue;
    const range = toRange(date, nightCount);
    const key = `${range.check_in}/${range.check_out}`;
    if (!selectedKeys.has(key)) {
      selected.push(range);
      selectedKeys.add(key);
    }
  }
  for (const range of allRanges) {
    if (selected.length >= limit) break;
    const key = `${range.check_in}/${range.check_out}`;
    if (!selectedKeys.has(key)) {
      selected.push(range);
      selectedKeys.add(key);
    }
  }
  return selected;
}

export function planFlexibleDates(
  input: SearchFlexibleStaysInput,
): DateRange[] {
  const { first, last } = parseFlexibleWindow(input);
  const dates = eligibleDates(
    first,
    last,
    new Set(input.preferred_check_in_days),
  );
  const nights = [...new Set(input.nights)];
  const allRanges = dates.flatMap((date) =>
    nights.map((nightCount) => toRange(date, nightCount)),
  );
  if (allRanges.length <= input.max_date_combinations) return allRanges;
  return sampleRanges(dates, nights, allRanges, input.max_date_combinations);
}

function countFlexibleDateCombinations(
  input: SearchFlexibleStaysInput,
): number {
  const first = Date.parse(`${input.earliest_check_in}T00:00:00Z`);
  const last = Date.parse(`${input.latest_check_in}T00:00:00Z`);
  const allowedDays = new Set(input.preferred_check_in_days);
  let eligible = 0;
  for (let timestamp = first; timestamp <= last; timestamp += 86_400_000) {
    if (
      allowedDays.size === 0 ||
      allowedDays.has(new Date(timestamp).getUTCDay())
    ) {
      eligible += 1;
    }
  }
  return eligible * new Set(input.nights).size;
}

function mergeListings(
  results: SearchResult[],
  input: SearchFlexibleStaysInput,
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
  return sortListings([...byListing.values()], input.sort).slice(
    0,
    input.limit,
  );
}

function flexibleWarnings(
  results: SearchResult[],
  sampled: boolean,
  failures: number,
): string[] {
  const warnings = [
    ...results.flatMap((result) => result.warnings),
    ...(sampled
      ? [
          "The date window was sampled within max_date_combinations; not every combination was searched.",
        ]
      : []),
    ...(failures > 0
      ? [`${failures} date-range search(es) failed before the deadline.`]
      : []),
  ];
  return [...new Set(warnings)];
}

function summarizeFlexibleSearch(
  input: SearchFlexibleStaysInput,
  ranges: DateRange[],
  results: SearchResult[],
  failures: number,
  startedAt: number,
): FlexibleResult {
  const listings = mergeListings(results, input);
  const sampled = countFlexibleDateCombinations(input) > ranges.length;
  const cacheStatuses = [...new Set(results.map((result) => result.cache))];
  const fetchedTimes = results
    .map((result) => Date.parse(result.freshness.fetched_at))
    .filter(Number.isFinite);
  const fetchedAt =
    fetchedTimes.length > 0
      ? new Date(Math.min(...fetchedTimes)).toISOString()
      : new Date().toISOString();
  return {
    listings,
    searched_date_ranges: ranges,
    total_returned: listings.length,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    cache: cacheStatuses.length === 1 ? (cacheStatuses[0] ?? "mixed") : "mixed",
    freshness: {
      fetched_at: fetchedAt,
      age_seconds: Math.max(
        ...results.map((result) => result.freshness.age_seconds),
      ),
      stale: results.some((result) => result.freshness.stale),
    },
    sampled,
    partial: failures > 0,
    warnings: flexibleWarnings(results, sampled, failures),
    schema_version: "1.0",
  };
}

export async function searchFlexibleStays(
  input: SearchFlexibleStaysInput,
  ctx: ExecutionContext,
): Promise<FlexibleResult> {
  const startedAt = performance.now();
  const ranges = planFlexibleDates(input);
  const probe: SearchStaysInput = {
    ...input,
    check_in: ranges[0]?.check_in ?? input.earliest_check_in,
    check_out: ranges[0]?.check_out ?? input.earliest_check_in,
    cursor: undefined,
  };
  const location = await resolveSearchLocation(probe, ctx);
  const calls = ranges.map((range) =>
    searchStays(
      {
        ...input,
        ...range,
        location: location.label,
        place_id: location.placeId,
        bounds: location.bounds,
        cursor: undefined,
      },
      ctx,
    ),
  );
  const settled = await Promise.allSettled(calls);
  const successful = settled
    .filter(
      (result): result is PromiseFulfilledResult<SearchResult> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
  if (successful.length === 0) {
    const failure = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw failure?.reason instanceof Error
      ? failure.reason
      : new Error("All flexible-date searches failed");
  }
  return summarizeFlexibleSearch(
    input,
    ranges,
    successful,
    settled.length - successful.length,
    startedAt,
  );
}
