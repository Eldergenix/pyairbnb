import type {
  AvailabilityResult,
  Bounds,
  ListingCard,
  QuoteResult,
} from "../schemas.js";

export interface RawParam {
  filterName: string;
  filterValues: string[];
}

export interface ResolvedSearchLocation {
  label: string;
  placeId?: string;
  bounds?: Bounds;
}

export interface SearchPage {
  listings: ListingCard[];
  nextCursor: string | null;
  filtersApplied: string[];
  locationLabel: string;
  warnings: string[];
}

export interface QuotePayload {
  available: boolean;
  price: QuoteResult["price"];
  unavailableReason: string | null;
}

export type AvailabilityMonth = AvailabilityResult["months"][number];
