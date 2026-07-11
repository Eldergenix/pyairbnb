import { z } from "zod";
import { isoDate } from "./common.js";

export const searchExperiencesInputShape = {
  location: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .describe("Human-readable location; resolved to an Airbnb place before searching"),
  check_in: isoDate.optional().describe("Optional; include with check_out to bound dates"),
  check_out: isoDate.optional(),
  start_time_after: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use 24-hour HH:MM")
    .optional()
    .describe("Keep only experiences whose earliest start time is at or after this local time"),
  start_time_before: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use 24-hour HH:MM")
    .optional()
    .describe("Keep only experiences whose earliest start time is at or before this local time"),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  language: z.string().trim().min(2).max(10).default("en"),
  limit: z.number().int().min(1).max(40).default(20),
  cursor: z.string().max(4096).optional(),
  require_fresh: z.boolean().default(false),
};

export const searchExperiencesInputSchema = z
  .object(searchExperiencesInputShape)
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

export type SearchExperiencesInput = z.infer<typeof searchExperiencesInputSchema>;
