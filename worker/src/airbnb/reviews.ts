import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import type { ReviewsInput, ReviewsResult } from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  REVIEWS_OPERATION_ID,
  apiHeaders,
  encodeNodeId,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import { array, number, path, record, string } from "./payload.js";

type ReviewRow = ReviewsResult["reviews"][number];

function normalizeReview(value: unknown): ReviewRow | null {
  const review = record(value);
  if (!review) return null;
  const reviewer = record(review.reviewer);
  const id = string(review.id);
  const text = string(review.comments);
  if (!id && !text) return null;
  return {
    id,
    rating: number(review.rating),
    text,
    created_at: string(review.createdAt) || string(review.localizedDate),
    reviewer_name:
      string(reviewer?.firstName) ||
      string(reviewer?.smartName) ||
      string(reviewer?.hostName),
    reviewer_location:
      string(review.localizedReviewerLocation) || string(reviewer?.location),
    language: string(review.language),
    response: string(review.response),
  };
}

function parseReviewsPayload(payload: unknown) {
  if (array(path(payload, ["errors"])).length > 0) {
    throw new UpstreamError(
      "upstream_graphql_error",
      "Airbnb reviews response included errors",
    );
  }
  const container = record(
    path(payload, ["data", "presentation", "stayProductDetailPage", "reviews"]),
  );
  if (!container) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb reviews response was incomplete",
    );
  }
  const metadata = record(container.metadata);
  const reviews = array(container.reviews)
    .map(normalizeReview)
    .filter((review): review is ReviewRow => review !== null);
  const categoryRatings = array(
    metadata?.ratingBreakdown ?? container.ratingBreakdown,
  )
    .map((entry) => {
      const item = record(entry);
      return {
        category: string(item?.category) || string(item?.label),
        value: number(item?.value) ?? number(item?.rating),
      };
    })
    .filter((entry) => entry.category);
  return {
    reviews,
    overall_rating:
      number(metadata?.overallRating) ?? number(container.overallRating),
    review_count:
      number(metadata?.reviewCount) ?? number(container.reviewsCount),
    category_ratings: categoryRatings,
  };
}

async function loadReviews(input: ReviewsInput, ctx: ExecutionContext) {
  const variables = {
    id: encodeNodeId("StayListing", input.listing_id),
    pdpReviewsRequest: {
      fieldSelector: "for_p3_translation_only",
      forPreview: false,
      limit: input.limit,
      offset: String(input.offset),
      showingTranslationButton: false,
      first: input.limit,
      sortingPreference: "MOST_RECENT",
      numberOfAdults: "1",
      numberOfChildren: "0",
      numberOfInfants: "0",
      numberOfPets: "0",
      after: null,
    },
  };
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: REVIEWS_OPERATION_ID },
  };
  const url = new URL(
    `/api/v3/StaysPdpReviewsQuery/${REVIEWS_OPERATION_ID}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "StaysPdpReviewsQuery");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  url.searchParams.set("variables", JSON.stringify(variables));
  url.searchParams.set("extensions", JSON.stringify(extensions));
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
    return parseReviewsPayload(payload);
  });
}

export async function getListingReviews(
  input: ReviewsInput,
  ctx: ExecutionContext,
): Promise<ReviewsResult> {
  const startedAt = performance.now();
  const cached = await readThroughCache({
    namespace: "listing-reviews-v1",
    key: { ...input, require_fresh: undefined },
    freshTtlSeconds: 30 * 60,
    staleTtlSeconds: 6 * 60 * 60,
    requireFresh: input.require_fresh,
    negativeTtlSeconds: 30,
    ctx,
    load: () => loadReviews(input, ctx),
  });
  const returned = cached.value.reviews.length;
  return {
    listing_id: input.listing_id,
    overall_rating: cached.value.overall_rating,
    review_count: cached.value.review_count,
    category_ratings: cached.value.category_ratings,
    reviews: cached.value.reviews,
    returned,
    next_offset: returned === input.limit ? input.offset + input.limit : null,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    fetched_at: cached.fetchedAt,
    schema_version: "1.0",
  };
}
