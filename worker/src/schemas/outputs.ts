import { z } from "zod";
import { isoDate, listingCardSchema } from "./common.js";

const cacheStatusSchema = z.enum(["hit", "miss", "stale", "bypass"]);
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
  searched_date_ranges: z.array(
    z.object({ check_in: isoDate, check_out: isoDate }),
  ),
  total_returned: z.number().int().nonnegative(),
  timing_ms: z.number().nonnegative(),
  cache: z.enum(["hit", "miss", "stale", "bypass", "mixed"]),
  freshness: freshnessSchema,
  sampled: z.boolean(),
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

export type SearchResult = z.infer<typeof searchResultSchema>;
export type FlexibleResult = z.infer<typeof flexibleResultSchema>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>;
