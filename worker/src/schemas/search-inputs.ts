import { z } from "zod";
import { boundsSchema, isoDate, roomTypeSchema, sortSchema } from "./common.js";

export const searchStaysInputShape = {
  location: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .optional()
    .describe("Human-readable location; omit when bounds are supplied"),
  place_id: z
    .string()
    .trim()
    .max(220)
    .optional()
    .describe("Place ID returned by resolve_location"),
  bounds: boundsSchema.optional().describe("Map bounds returned by resolve_location"),
  check_in: isoDate,
  check_out: isoDate,
  adults: z.number().int().min(1).max(16).default(1),
  children: z.number().int().min(0).max(10).default(0),
  infants: z.number().int().min(0).max(5).default(0),
  pets: z.number().int().min(0).max(5).default(0),
  price_min: z
    .number()
    .int()
    .min(0)
    .max(100000)
    .optional()
    .describe("Minimum nightly price in the requested currency"),
  price_max: z
    .number()
    .int()
    .min(0)
    .max(100000)
    .optional()
    .describe("Maximum nightly price in the requested currency"),
  room_types: z.array(roomTypeSchema).max(4).default([]),
  amenity_ids: z.array(z.number().int().positive()).max(40).default([]),
  property_type_ids: z.array(z.number().int().positive()).max(30).default([]),
  accessibility_feature_ids: z
    .array(z.number().int().positive())
    .max(30)
    .default([]),
  free_cancellation: z.boolean().default(false),
  instant_book: z.boolean().default(false),
  superhost: z.boolean().default(false),
  min_bedrooms: z.number().int().min(0).max(50).default(0),
  min_beds: z.number().int().min(0).max(100).default(0),
  min_bathrooms: z.number().min(0).max(50).default(0),
  min_rating: z.number().min(0).max(5).default(0),
  min_reviews: z.number().int().min(0).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  sort: sortSchema.default("recommended"),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().max(4096).optional(),
  require_fresh: z
    .boolean()
    .default(false)
    .describe("Bypass a stale cache entry; live-origin latency is best effort"),
};

function addSearchIssues(
  input: {
    location?: string;
    place_id?: string;
    bounds?: unknown;
    price_min?: number;
    price_max?: number;
  },
  context: z.RefinementCtx,
): void {
  if (!input.location && !input.place_id && !input.bounds) {
    context.addIssue({ code: "custom", message: "Provide location, place_id, or bounds" });
  }
  if (
    input.price_min !== undefined &&
    input.price_max !== undefined &&
    input.price_min > input.price_max
  ) {
    context.addIssue({
      code: "custom",
      path: ["price_min"],
      message: "price_min must be less than or equal to price_max",
    });
  }
}

export const searchStaysInputSchema = z
  .object(searchStaysInputShape)
  .strict()
  .superRefine(addSearchIssues);

export const searchFlexibleStaysInputShape = {
  location: z.string().trim().min(2).max(160).optional(),
  place_id: z.string().trim().max(220).optional(),
  bounds: boundsSchema.optional(),
  earliest_check_in: isoDate,
  latest_check_in: isoDate,
  nights: z
    .array(z.number().int().min(1).max(90))
    .min(1)
    .max(4)
    .refine((values) => new Set(values).size === values.length, "Trip lengths must be unique")
    .default([2]),
  preferred_check_in_days: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .default([])
    .describe("UTC weekday numbers, Sunday=0 through Saturday=6"),
  max_date_combinations: z.number().int().min(1).max(6).default(4),
  adults: searchStaysInputShape.adults,
  children: searchStaysInputShape.children,
  infants: searchStaysInputShape.infants,
  pets: searchStaysInputShape.pets,
  price_min: searchStaysInputShape.price_min,
  price_max: searchStaysInputShape.price_max,
  room_types: searchStaysInputShape.room_types,
  amenity_ids: searchStaysInputShape.amenity_ids,
  property_type_ids: searchStaysInputShape.property_type_ids,
  accessibility_feature_ids: searchStaysInputShape.accessibility_feature_ids,
  free_cancellation: searchStaysInputShape.free_cancellation,
  instant_book: searchStaysInputShape.instant_book,
  superhost: searchStaysInputShape.superhost,
  min_bedrooms: searchStaysInputShape.min_bedrooms,
  min_beds: searchStaysInputShape.min_beds,
  min_bathrooms: searchStaysInputShape.min_bathrooms,
  min_rating: searchStaysInputShape.min_rating,
  min_reviews: searchStaysInputShape.min_reviews,
  currency: searchStaysInputShape.currency,
  language: searchStaysInputShape.language,
  sort: searchStaysInputShape.sort,
  limit: z.number().int().min(1).max(50).default(20),
  require_fresh: searchStaysInputShape.require_fresh,
};

export const searchFlexibleStaysInputSchema = z
  .object(searchFlexibleStaysInputShape)
  .strict()
  .superRefine((input, context) => {
    addSearchIssues(input, context);
    if (input.latest_check_in < input.earliest_check_in) {
      context.addIssue({
        code: "custom",
        path: ["latest_check_in"],
        message: "latest_check_in must be on or after earliest_check_in",
      });
    }
  });

export type SearchStaysInput = z.infer<typeof searchStaysInputSchema>;
export type SearchFlexibleStaysInput = z.infer<
  typeof searchFlexibleStaysInputSchema
>;
