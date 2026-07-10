import { classifyPublicError } from "../errors.js";
import type {
  CompareListingsInput,
  CompareResult,
  QuoteResult,
} from "../schemas.js";
import { AIRBNB_ORIGIN } from "./client.js";
import { getListingQuote } from "./quote.js";
import { validateDateRange } from "./search-filters.js";

type CompareRow = CompareResult["listings"][number];

function listingUrl(listingId: string, input: CompareListingsInput): string {
  const url = new URL(`/rooms/${listingId}`, AIRBNB_ORIGIN);
  url.searchParams.set("check_in", input.check_in);
  url.searchParams.set("check_out", input.check_out);
  return url.toString();
}

function rowFromQuote(quote: QuoteResult): CompareRow {
  return {
    listing_id: quote.listing_id,
    url: `${AIRBNB_ORIGIN}/rooms/${quote.listing_id}?check_in=${quote.check_in}&check_out=${quote.check_out}`,
    available: quote.available,
    price: {
      total: quote.price.total,
      nightly: quote.price.nightly,
      display: quote.price.display,
    },
    unavailable_reason: quote.unavailable_reason,
    cache: quote.cache,
    error: null,
  };
}

function rowFromError(listingId: string, input: CompareListingsInput, error: unknown): CompareRow {
  return {
    listing_id: listingId,
    url: listingUrl(listingId, input),
    available: false,
    price: { total: null, nightly: null, display: "" },
    unavailable_reason: null,
    cache: "miss",
    error: classifyPublicError(error).body.error,
  };
}

function mergeCacheStatus(rows: CompareRow[]): CompareResult["cache"] {
  const statuses = new Set(rows.map((row) => row.cache));
  if (statuses.size === 0) return "miss";
  if (statuses.size === 1) return [...statuses][0] ?? "miss";
  return "mixed";
}

export async function compareListings(
  input: CompareListingsInput,
  ctx: ExecutionContext,
): Promise<CompareResult> {
  const startedAt = performance.now();
  const nights = validateDateRange(input.check_in, input.check_out);
  const settled = await Promise.allSettled(
    input.listing_ids.map((listingId) =>
      getListingQuote(
        {
          listing_id: listingId,
          check_in: input.check_in,
          check_out: input.check_out,
          adults: input.adults,
          children: input.children,
          infants: input.infants,
          pets: input.pets,
          currency: input.currency,
          language: input.language,
          require_fresh: input.require_fresh,
        },
        ctx,
      ),
    ),
  );
  const rows = settled.map((result, index) => {
    const listingId = input.listing_ids[index] ?? "";
    return result.status === "fulfilled"
      ? rowFromQuote(result.value)
      : rowFromError(listingId, input, result.reason);
  });
  const failures = rows.filter((row) => row.error !== null).length;
  const cheapest = rows
    .filter((row) => row.available && row.price.total !== null)
    .sort(
      (left, right) => (left.price.total ?? Infinity) - (right.price.total ?? Infinity),
    )[0];
  return {
    check_in: input.check_in,
    check_out: input.check_out,
    nights,
    currency: input.currency,
    listings: rows,
    cheapest_available_listing_id: cheapest?.listing_id ?? null,
    cache: mergeCacheStatus(rows),
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    partial: failures > 0,
    warnings:
      failures > 0
        ? [`${failures} listing quote(s) could not be retrieved.`]
        : [],
    schema_version: "1.0",
  };
}
