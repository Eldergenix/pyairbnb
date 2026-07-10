import { RequestError } from "../errors.js";
import type { SearchStaysInput } from "../schemas.js";
import type { RawParam, ResolvedSearchLocation } from "./types.js";

function addParam(params: RawParam[], name: string, values: string[]): void {
  if (values.length > 0)
    params.push({ filterName: name, filterValues: values });
}

export function validateDateRange(checkIn: string, checkOut: string): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  const nights = (end - start) / 86_400_000;
  if (!Number.isInteger(nights) || nights < 1 || nights > 365) {
    throw new RequestError(
      "invalid_date_range",
      "check_out must be 1 to 365 days after check_in",
    );
  }
  return nights;
}

function addLocationFilters(
  params: RawParam[],
  location: ResolvedSearchLocation,
): void {
  if (location.label) addParam(params, "query", [location.label]);
  if (location.placeId) addParam(params, "placeId", [location.placeId]);
  if (!location.bounds) return;
  addParam(params, "neLat", [String(location.bounds.northeast_latitude)]);
  addParam(params, "neLng", [String(location.bounds.northeast_longitude)]);
  addParam(params, "swLat", [String(location.bounds.southwest_latitude)]);
  addParam(params, "swLng", [String(location.bounds.southwest_longitude)]);
  addParam(params, "zoomLevel", ["12"]);
}

function addCapabilityFilters(
  params: RawParam[],
  input: SearchStaysInput,
): void {
  addParam(params, "room_types", input.room_types);
  addParam(params, "amenities", input.amenity_ids.map(String));
  addParam(params, "l2_property_type_ids", input.property_type_ids.map(String));
  addParam(
    params,
    "accessibility_features",
    input.accessibility_feature_ids.map(String),
  );
  if (input.free_cancellation)
    addParam(params, "flexible_cancellation", ["true"]);
  if (input.instant_book) addParam(params, "ib", ["true"]);
  if (input.superhost) addParam(params, "superhost", ["true"]);
  if (input.min_bedrooms > 0)
    addParam(params, "min_bedrooms", [String(input.min_bedrooms)]);
  if (input.min_beds > 0)
    addParam(params, "min_beds", [String(input.min_beds)]);
  if (input.min_bathrooms > 0)
    addParam(params, "min_bathrooms", [String(input.min_bathrooms)]);
}

export function buildSearchFilters(
  input: SearchStaysInput,
  location: ResolvedSearchLocation,
): RawParam[] {
  const nights = validateDateRange(input.check_in, input.check_out);
  const params: RawParam[] = [];
  const defaults: Record<string, string> = {
    cdnCacheSafe: "true",
    channel: "EXPLORE",
    datePickerType: "calendar",
    itemsPerGrid: String(input.limit),
    priceFilterInputType: "0",
    refinementPaths: "/homes",
    screenSize: "large",
    searchByMap: "true",
    tabId: "home_tab",
    version: "1.8.3",
    checkin: input.check_in,
    checkout: input.check_out,
    priceFilterNumNights: String(nights),
  };
  for (const [name, value] of Object.entries(defaults))
    addParam(params, name, [value]);
  addLocationFilters(params, location);

  addParam(params, "adults", [String(input.adults)]);
  if (input.children > 0)
    addParam(params, "children", [String(input.children)]);
  if (input.infants > 0) addParam(params, "infants", [String(input.infants)]);
  if (input.pets > 0) addParam(params, "pets", [String(input.pets)]);
  if (input.price_min !== undefined)
    addParam(params, "price_min", [String(input.price_min)]);
  if (input.price_max !== undefined)
    addParam(params, "price_max", [String(input.price_max)]);
  addCapabilityFilters(params, input);
  return params;
}

export function appliedFilters(input: SearchStaysInput): string[] {
  const names = ["location", "check_in", "check_out", "adults", "currency"];
  const optional: Array<[string, boolean]> = [
    ["children", input.children > 0],
    ["infants", input.infants > 0],
    ["pets", input.pets > 0],
    ["price_min", input.price_min !== undefined],
    ["price_max", input.price_max !== undefined],
    ["room_types", input.room_types.length > 0],
    ["amenity_ids", input.amenity_ids.length > 0],
    ["property_type_ids", input.property_type_ids.length > 0],
    ["accessibility_feature_ids", input.accessibility_feature_ids.length > 0],
    ["free_cancellation", input.free_cancellation],
    ["instant_book", input.instant_book],
    ["superhost", input.superhost],
    ["min_bedrooms", input.min_bedrooms > 0],
    ["min_beds", input.min_beds > 0],
    ["min_bathrooms", input.min_bathrooms > 0],
    ["min_rating", input.min_rating > 0],
    ["min_reviews", input.min_reviews > 0],
  ];
  return names.concat(
    optional.filter(([, enabled]) => enabled).map(([name]) => name),
  );
}
