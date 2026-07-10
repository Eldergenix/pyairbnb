import { z } from "zod";

export const resolveLocationInputShape = {
  query: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .describe("City, neighborhood, landmark, address, region, or country"),
  country_code: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .optional()
    .describe("Optional ISO 3166-1 alpha-2 country hint"),
  language: z.string().trim().min(2).max(10).default("en"),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  limit: z.number().int().min(1).max(10).default(5),
};

export const resolveLocationInputSchema = z
  .object(resolveLocationInputShape)
  .strict();

export type ResolveLocationInput = z.infer<typeof resolveLocationInputSchema>;
