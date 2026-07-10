import { z } from "zod";
import { detailLevelSchema, isoDate, roomTypeSchema, sortSchema } from "./common.js";

const digitId = z.string().regex(/^\d+$/, "listing_id must contain only digits");

export const compareListingsInputShape = {
  listing_ids: z
    .array(digitId)
    .min(2)
    .max(8)
    .refine((values) => new Set(values).size === values.length, "listing_ids must be unique")
    .describe("Two to eight listing IDs to price side by side for the same dates"),
  check_in: isoDate,
  check_out: isoDate,
  adults: z.number().int().min(1).max(16).default(1),
  children: z.number().int().min(0).max(10).default(0),
  infants: z.number().int().min(0).max(5).default(0),
  pets: z.number().int().min(0).max(5).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  require_fresh: z.boolean().default(false),
};

export const compareListingsInputSchema = z
  .object(compareListingsInputShape)
  .strict()
  .refine((input) => input.check_out > input.check_in, {
    path: ["check_out"],
    message: "check_out must be after check_in",
  });

export const multiSearchInputShape = {
  locations: z
    .array(z.string().trim().min(2).max(160))
    .min(1)
    .max(5)
    .refine((values) => new Set(values).size === values.length, "locations must be unique")
    .describe("One to five human-readable locations searched concurrently and merged"),
  check_in: isoDate,
  check_out: isoDate,
  adults: z.number().int().min(1).max(16).default(1),
  children: z.number().int().min(0).max(10).default(0),
  infants: z.number().int().min(0).max(5).default(0),
  pets: z.number().int().min(0).max(5).default(0),
  price_min: z.number().int().min(0).max(100000).optional(),
  price_max: z.number().int().min(0).max(100000).optional(),
  room_types: z.array(roomTypeSchema).max(4).default([]),
  amenity_ids: z.array(z.number().int().positive()).max(40).default([]),
  property_type_ids: z.array(z.number().int().positive()).max(30).default([]),
  free_cancellation: z.boolean().default(false),
  instant_book: z.boolean().default(false),
  superhost: z.boolean().default(false),
  min_bedrooms: z.number().int().min(0).max(50).default(0),
  min_rating: z.number().min(0).max(5).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  sort: sortSchema.default("recommended"),
  per_location_limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(12)
    .describe("Cards fetched from each location before merging"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(20)
    .describe("Maximum cards after merging and de-duplicating across locations"),
  detail_level: detailLevelSchema,
  require_fresh: z.boolean().default(false),
};

export const multiSearchInputSchema = z
  .object(multiSearchInputShape)
  .strict()
  .superRefine((input, context) => {
    if (input.check_out <= input.check_in) {
      context.addIssue({
        code: "custom",
        path: ["check_out"],
        message: "check_out must be after check_in",
      });
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
  });

export type CompareListingsInput = z.infer<typeof compareListingsInputSchema>;
export type MultiSearchInput = z.infer<typeof multiSearchInputSchema>;
