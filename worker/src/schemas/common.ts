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
