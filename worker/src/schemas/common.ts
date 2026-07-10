import { z } from "zod";

function isCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format")
  .refine(isCalendarDate, "Use a real calendar date");

export const isoMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Use YYYY-MM")
  .refine((value) => {
    const month = Number(value.slice(5));
    return month >= 1 && month <= 12;
  }, "Use a real calendar month");

export const boundsSchema = z
  .object({
    northeast_latitude: z.number().min(-90).max(90),
    northeast_longitude: z.number().min(-180).max(180),
    southwest_latitude: z.number().min(-90).max(90),
    southwest_longitude: z.number().min(-180).max(180),
  })
  .refine(
    (bounds) => bounds.northeast_latitude > bounds.southwest_latitude,
    "northeast_latitude must be north of southwest_latitude",
  );

export const roomTypeSchema = z.enum([
  "Entire home/apt",
  "Private room",
  "Shared room",
  "Hotel room",
]);

export const sortSchema = z.enum([
  "recommended",
  "price_low_to_high",
  "price_high_to_low",
  "rating",
]);

export const detailLevelSchema = z
  .enum(["compact", "standard", "full"])
  .default("standard")
  .describe(
    "Controls the text payload the model reads: compact is smallest, full adds facets. The widget/RSC always receive the canonical structuredContent.",
  );

export const searchFacetsSchema = z.object({
  count: z.number().int().nonnegative(),
  price: z.object({
    currency: z.string(),
    basis: z.literal("nightly"),
    counted: z.number().int().nonnegative(),
    min: z.number().nullable(),
    p25: z.number().nullable(),
    median: z.number().nullable(),
    p75: z.number().nullable(),
    max: z.number().nullable(),
  }),
  rating: z.object({
    counted: z.number().int().nonnegative(),
    average: z.number().nullable(),
  }),
  guest_favorites: z.number().int().nonnegative(),
  top_badges: z.array(
    z.object({ label: z.string(), count: z.number().int().positive() }),
  ),
});

export type SearchFacets = z.infer<typeof searchFacetsSchema>;

export const locationCandidateSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  place_id: z.string(),
  country_code: z.string(),
  types: z.array(z.string()),
  bounds: boundsSchema,
});

export const listingCardSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  name: z.string(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  price: z.object({
    currency: z.string(),
    total: z.number().nullable(),
    nightly: z.number().nullable(),
    display: z.string(),
    qualifier: z.string(),
  }),
  rating: z.number().min(0).max(5).nullable(),
  review_count: z.number().int().nullable(),
  images: z.array(
    z.object({
      url: z.string().url(),
      alt: z.string(),
    }),
  ),
  badges: z.array(z.string()),
  guest_favorite: z.boolean(),
  check_in: isoDate,
  check_out: isoDate,
  nights: z.number().int().positive(),
  source: z.literal("airbnb"),
});

export type Bounds = z.infer<typeof boundsSchema>;
export type LocationCandidate = z.infer<typeof locationCandidateSchema>;
export type ListingCard = z.infer<typeof listingCardSchema>;
