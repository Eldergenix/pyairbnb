import { z } from "zod";
import { isoDate, isoMonth } from "./common.js";

export const quoteInputShape = {
  listing_id: z.string().regex(/^\d+$/, "listing_id must contain only digits"),
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

export const quoteInputSchema = z
  .object(quoteInputShape)
  .strict()
  .refine((input) => input.check_out > input.check_in, {
    path: ["check_out"],
    message: "check_out must be after check_in",
  });

export const availabilityInputShape = {
  listing_id: z.string().regex(/^\d+$/, "listing_id must contain only digits"),
  start_month: isoMonth,
  months: z.number().int().min(1).max(6).default(3),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  require_fresh: z.boolean().default(false),
};

export const availabilityInputSchema = z
  .object(availabilityInputShape)
  .strict();

export type QuoteInput = z.infer<typeof quoteInputSchema>;
export type AvailabilityInput = z.infer<typeof availabilityInputSchema>;
