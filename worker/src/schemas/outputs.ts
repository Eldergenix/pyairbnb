import { z } from "zod";
import { isoDate, listingCardSchema, searchFacetsSchema } from "./common.js";

const cacheStatusSchema = z.enum(["hit", "miss", "stale", "bypass"]);
const mixedCacheStatusSchema = z.enum([
  "hit",
  "miss",
  "stale",
  "bypass",
  "mixed",
]);
const freshnessSchema = z.object({
  fetched_at: z.string(),
  age_seconds: z.number().nonnegative(),
  stale: z.boolean(),
});

export const searchResultSchema = z.object({
  query: z.object({
    location: z.string(),
    check_in: isoDate,
    check_out: isoDate,
    currency: z.string(),
  }),
  listings: z.array(listingCardSchema),
  facets: searchFacetsSchema,
  next_cursor: z.string().nullable(),
  total_returned: z.number().int().nonnegative(),
  cache: cacheStatusSchema,
  freshness: freshnessSchema,
  timing_ms: z.number().nonnegative(),
  filters_applied: z.array(z.string()),
  warnings: z.array(z.string()),
  schema_version: z.literal("1.0"),
});

export const flexibleResultSchema = z.object({
  listings: z.array(listingCardSchema),
  facets: searchFacetsSchema,
  searched_date_ranges: z.array(
    z.object({ check_in: isoDate, check_out: isoDate }),
  ),
  total_returned: z.number().int().nonnegative(),
  timing_ms: z.number().nonnegative(),
  cache: mixedCacheStatusSchema,
  freshness: freshnessSchema,
  sampled: z.boolean(),
  partial: z.boolean(),
  warnings: z.array(z.string()),
  schema_version: z.literal("1.0"),
});

export const multiSearchResultSchema = z.object({
  listings: z.array(listingCardSchema),
  facets: searchFacetsSchema,
  queries: z.array(
    z.object({
      label: z.string(),
      total_returned: z.number().int().nonnegative(),
      cache: cacheStatusSchema,
      warnings: z.array(z.string()),
      error: z.string().nullable(),
    }),
  ),
  total_returned: z.number().int().nonnegative(),
  cache: mixedCacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  partial: z.boolean(),
  warnings: z.array(z.string()),
  schema_version: z.literal("1.0"),
});

export const compareResultSchema = z.object({
  check_in: isoDate,
  check_out: isoDate,
  nights: z.number().int().positive(),
  currency: z.string(),
  listings: z.array(
    z.object({
      listing_id: z.string(),
      url: z.string().url(),
      available: z.boolean(),
      price: z.object({
        total: z.number().nullable(),
        nightly: z.number().nullable(),
        display: z.string(),
      }),
      unavailable_reason: z.string().nullable(),
      cache: cacheStatusSchema,
      error: z.string().nullable(),
    }),
  ),
  cheapest_available_listing_id: z.string().nullable(),
  cache: mixedCacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  partial: z.boolean(),
  warnings: z.array(z.string()),
  schema_version: z.literal("1.0"),
});

export const quoteResultSchema = z.object({
  listing_id: z.string(),
  available: z.boolean(),
  check_in: isoDate,
  check_out: isoDate,
  nights: z.number().int().positive(),
  currency: z.string(),
  price: z.object({
    total: z.number().nullable(),
    nightly: z.number().nullable(),
    display: z.string(),
    original_display: z.string(),
    qualifier: z.string(),
    line_items: z.array(
      z.object({
        label: z.string(),
        amount: z.number().nullable(),
        display: z.string(),
      }),
    ),
  }),
  unavailable_reason: z.string().nullable(),
  cache: cacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  fetched_at: z.string(),
  schema_version: z.literal("1.0"),
});

export const availabilityResultSchema = z.object({
  listing_id: z.string(),
  months: z.array(
    z.object({
      month: z.number().int().min(1).max(12),
      year: z.number().int(),
      days: z.array(
        z.object({
          date: isoDate,
          available: z.boolean(),
          min_nights: z.number().int().nonnegative().nullable(),
          max_nights: z.number().int().nonnegative().nullable(),
        }),
      ),
    }),
  ),
  cache: cacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  fetched_at: z.string(),
  schema_version: z.literal("1.0"),
});

export const reviewsResultSchema = z.object({
  listing_id: z.string(),
  overall_rating: z.number().nullable(),
  review_count: z.number().int().nonnegative().nullable(),
  category_ratings: z.array(
    z.object({ category: z.string(), value: z.number().nullable() }),
  ),
  reviews: z.array(
    z.object({
      id: z.string(),
      rating: z.number().nullable(),
      text: z.string(),
      created_at: z.string(),
      reviewer_name: z.string(),
      reviewer_location: z.string(),
      language: z.string(),
      response: z.string(),
    }),
  ),
  returned: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  cache: cacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  fetched_at: z.string(),
  schema_version: z.literal("1.0"),
});

export const detailsResultSchema = z.object({
  listing_id: z.string(),
  url: z.string().url(),
  title: z.string(),
  subtitle: z.string(),
  description: z.string(),
  coordinates: z
    .object({ latitude: z.number(), longitude: z.number() })
    .nullable(),
  person_capacity: z.number().int().nonnegative().nullable(),
  room_type: z.string(),
  rating: z.number().nullable(),
  review_count: z.number().int().nonnegative().nullable(),
  amenity_groups: z.array(
    z.object({
      title: z.string(),
      amenities: z.array(
        z.object({ name: z.string(), available: z.boolean() }),
      ),
    }),
  ),
  house_rules: z.array(z.string()),
  host: z.object({
    name: z.string(),
    is_superhost: z.boolean(),
    photo: z.string(),
  }),
  photos: z.array(z.object({ url: z.string(), alt: z.string() })),
  price: quoteResultSchema.shape.price.nullable(),
  cache: cacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  fetched_at: z.string(),
  schema_version: z.literal("1.0"),
});

export const hostListingsResultSchema = z.object({
  host_id: z.string(),
  listings: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      url: z.string().url(),
      city: z.string(),
      rating: z.number().nullable(),
      review_count: z.number().int().nonnegative().nullable(),
      picture: z.string(),
    }),
  ),
  returned: z.number().int().nonnegative(),
  next_offset: z.number().int().nonnegative().nullable(),
  cache: cacheStatusSchema,
  timing_ms: z.number().nonnegative(),
  fetched_at: z.string(),
  schema_version: z.literal("1.0"),
});

export type SearchResult = z.infer<typeof searchResultSchema>;
export type FlexibleResult = z.infer<typeof flexibleResultSchema>;
export type MultiSearchResult = z.infer<typeof multiSearchResultSchema>;
export type CompareResult = z.infer<typeof compareResultSchema>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;
export type ReviewsResult = z.infer<typeof reviewsResultSchema>;
export type DetailsResult = z.infer<typeof detailsResultSchema>;
export type HostListingsResult = z.infer<typeof hostListingsResultSchema>;
