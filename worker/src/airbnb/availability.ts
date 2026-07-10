import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import type { AvailabilityInput, AvailabilityResult } from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  AVAILABILITY_OPERATION_ID,
  apiHeaders,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import {
  array,
  path,
  record,
  string,
  toNonnegativeInteger,
} from "./payload.js";
import type { AvailabilityMonth } from "./types.js";

function normalizeAvailabilityMonth(value: unknown): AvailabilityMonth | null {
  const monthRecord = record(value);
  const month = toNonnegativeInteger(monthRecord?.month);
  const year = toNonnegativeInteger(monthRecord?.year);
  if (!month || !year) return null;
  const rawDays = monthRecord?.days;
  if (!Array.isArray(rawDays)) return null;
  const days = rawDays
    .map((day) => {
      const dayRecord = record(day);
      const date = string(dayRecord?.calendarDate) || string(dayRecord?.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      return {
        date,
        available: dayRecord?.available === true,
        min_nights:
          toNonnegativeInteger(dayRecord?.minNights) ??
          toNonnegativeInteger(dayRecord?.minimumNights),
        max_nights:
          toNonnegativeInteger(dayRecord?.maxNights) ??
          toNonnegativeInteger(dayRecord?.maximumNights),
      };
    })
    .filter((day): day is NonNullable<typeof day> => day !== null);
  return { month, year, days };
}

export function parseAvailabilityPayload(
  payload: unknown,
): AvailabilityMonth[] {
  if (array(path(payload, ["errors"])).length > 0) {
    throw new UpstreamError(
      "upstream_graphql_error",
      "Airbnb availability response included errors",
    );
  }
  const rawMonths = path(payload, [
    "data",
    "merlin",
    "pdpAvailabilityCalendar",
    "calendarMonths",
  ]);
  if (!Array.isArray(rawMonths) || rawMonths.length === 0) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb availability response was incomplete",
    );
  }
  const months = rawMonths
    .map(normalizeAvailabilityMonth)
    .filter((month): month is AvailabilityMonth => month !== null);
  if (months.length === 0) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb availability response was incomplete",
    );
  }
  return months;
}

async function loadAvailability(
  input: AvailabilityInput,
  ctx: ExecutionContext,
): Promise<AvailabilityMonth[]> {
  const [yearText, monthText] = input.start_month.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    throw new Error("start_month must be a valid YYYY-MM value");
  }
  const variables = {
    request: { count: input.months, listingId: input.listing_id, month, year },
  };
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: AVAILABILITY_OPERATION_ID },
  };
  const url = new URL(
    `/api/v3/PdpAvailabilityCalendar/${AVAILABILITY_OPERATION_ID}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "PdpAvailabilityCalendar");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify(extensions));
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
    return parseAvailabilityPayload(payload);
  });
}

export async function getAvailability(
  input: AvailabilityInput,
  ctx: ExecutionContext,
): Promise<AvailabilityResult> {
  const startedAt = performance.now();
  const cached = await readThroughCache({
    namespace: "listing-availability-v3",
    key: { ...input, require_fresh: undefined },
    freshTtlSeconds: 5 * 60,
    staleTtlSeconds: 60 * 60,
    requireFresh: input.require_fresh,
    ctx,
    load: () => loadAvailability(input, ctx),
  });
  return {
    listing_id: input.listing_id,
    months: cached.value,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    fetched_at: cached.fetchedAt,
    schema_version: "1.0",
  };
}
