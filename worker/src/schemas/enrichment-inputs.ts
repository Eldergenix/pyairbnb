import { z } from "zod";
import { isoDate } from "./common.js";

const digitId = z.string().regex(/^\d+$/, "must contain only digits");

export const reviewsInputShape = {
  listing_id: digitId,
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(12)
    .describe("Most recent reviews to return in this page"),
  offset: z.number().int().min(0).max(5000).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  require_fresh: z.boolean().default(false),
};

export const reviewsInputSchema = z.object(reviewsInputShape).strict();

export const detailsInputShape = {
  listing_id: digitId,
  check_in: isoDate.optional().describe("Optional; include with check_out to also price the stay"),
  check_out: isoDate.optional(),
  adults: z.number().int().min(1).max(16).default(1),
  children: z.number().int().min(0).max(10).default(0),
  infants: z.number().int().min(0).max(5).default(0),
  pets: z.number().int().min(0).max(5).default(0),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  require_fresh: z.boolean().default(false),
};

export const detailsInputSchema = z
  .object(detailsInputShape)
  .strict()
  .superRefine((input, context) => {
    const hasIn = input.check_in !== undefined;
    const hasOut = input.check_out !== undefined;
    if (hasIn !== hasOut) {
      context.addIssue({
        code: "custom",
        path: ["check_out"],
        message: "Provide both check_in and check_out, or neither",
      });
    }
    if (hasIn && hasOut && input.check_out! <= input.check_in!) {
      context.addIssue({
        code: "custom",
        path: ["check_out"],
        message: "check_out must be after check_in",
      });
    }
  });

export const hostListingsInputShape = {
  host_id: digitId,
  limit: z.number().int().min(1).max(50).default(18),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  require_fresh: z.boolean().default(false),
};

export const hostListingsInputSchema = z.object(hostListingsInputShape).strict();

export type ReviewsInput = z.infer<typeof reviewsInputSchema>;
export type DetailsInput = z.infer<typeof detailsInputSchema>;
export type HostListingsInput = z.infer<typeof hostListingsInputSchema>;
