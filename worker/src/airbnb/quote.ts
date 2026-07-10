import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import type { QuoteInput, QuoteResult } from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  QUOTE_OPERATION_ID,
  apiHeaders,
  encodeNodeId,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import { array, path, record, string } from "./payload.js";
import { parseDisplayNumber } from "./payload.js";
import { validateDateRange } from "./search-filters.js";
import type { QuotePayload } from "./types.js";

function findQuoteSection(payload: unknown): Record<string, unknown> {
  const rawSections = path(payload, [
    "data",
    "presentation",
    "stayProductDetailPage",
    "sections",
    "sections",
  ]);
  if (!Array.isArray(rawSections)) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb quote response was incomplete",
    );
  }
  const bookIt = rawSections.find(
    (section) => string(record(section)?.sectionId) === "BOOK_IT_SIDEBAR",
  );
  const section = record(record(bookIt)?.section);
  if (!section) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb quote response was incomplete",
    );
  }
  return section;
}

function normalizeLineItems(priceData: Record<string, unknown> | null) {
  return array(path(priceData, ["explanationData", "priceDetails"]))
    .flatMap((group) => array(record(group)?.items))
    .map((item) => {
      const itemRecord = record(item);
      const display = string(itemRecord?.priceString);
      return {
        label: string(itemRecord?.description),
        amount: parseDisplayNumber(display),
        display,
      };
    })
    .filter((item) => item.label || item.display);
}

export function parseQuotePayload(
  payload: unknown,
  input: QuoteInput,
): QuotePayload {
  if (array(path(payload, ["errors"])).length > 0) {
    throw new UpstreamError(
      "upstream_graphql_error",
      "Airbnb quote response included errors",
    );
  }
  const section = findQuoteSection(payload);
  const unavailableReason =
    string(section.localizedUnavailabilityMessage) || null;
  const priceData = record(section.structuredDisplayPrice);
  const primary = record(priceData?.primaryLine);
  const display =
    string(primary?.discountedPrice) ||
    string(primary?.price) ||
    string(primary?.originalPrice);
  const total = parseDisplayNumber(display);
  if (unavailableReason === null && total === null) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb quote response did not contain price or unavailability data",
    );
  }
  const nights = validateDateRange(input.check_in, input.check_out);
  return {
    available: unavailableReason === null && total !== null,
    price: {
      total,
      nightly: total === null ? null : Math.round((total / nights) * 100) / 100,
      display,
      original_display: string(primary?.originalPrice),
      qualifier: string(primary?.qualifier),
      line_items: normalizeLineItems(priceData),
    },
    unavailableReason,
  };
}

function quoteVariables(input: QuoteInput): Record<string, unknown> {
  return {
    id: encodeNodeId("StayListing", input.listing_id),
    demandStayListingId: encodeNodeId("DemandStayListing", input.listing_id),
    pdpSectionsRequest: {
      adults: String(input.adults),
      children: String(input.children),
      infants: String(input.infants),
      pets: input.pets,
      bypassTargetings: false,
      layouts: ["SIDEBAR", "SINGLE_COLUMN"],
      preview: false,
      privateBooking: false,
      useNewSectionWrapperApi: false,
      sectionIds: ["BOOK_IT_SIDEBAR", "POLICIES_DEFAULT"],
      checkIn: input.check_in,
      checkOut: input.check_out,
    },
  };
}

async function loadQuote(
  input: QuoteInput,
  ctx: ExecutionContext,
): Promise<QuotePayload> {
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: QUOTE_OPERATION_ID },
  };
  const url = new URL(
    `/api/v3/StaysPdpSections/${QUOTE_OPERATION_ID}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "StaysPdpSections");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  url.searchParams.set("variables", JSON.stringify(quoteVariables(input)));
  url.searchParams.set("extensions", JSON.stringify(extensions));
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
    return parseQuotePayload(payload, input);
  });
}

export async function getListingQuote(
  input: QuoteInput,
  ctx: ExecutionContext,
): Promise<QuoteResult> {
  const startedAt = performance.now();
  const nights = validateDateRange(input.check_in, input.check_out);
  const cached = await readThroughCache({
    namespace: "listing-quote-v3",
    key: { ...input, require_fresh: undefined },
    freshTtlSeconds: 60,
    staleTtlSeconds: 10 * 60,
    requireFresh: input.require_fresh,
    ctx,
    load: () => loadQuote(input, ctx),
  });
  return {
    listing_id: input.listing_id,
    available: cached.value.available,
    check_in: input.check_in,
    check_out: input.check_out,
    nights,
    currency: input.currency,
    price: cached.value.price,
    unavailable_reason: cached.value.unavailableReason,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    fetched_at: cached.fetchedAt,
    schema_version: "1.0",
  };
}
