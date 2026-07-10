import { describe, expect, it } from "vitest";
import {
  buildSearchFilters,
  normalizeSearchPrice,
  parseAvailabilityPayload,
  parseDisplayNumber,
  parseQuotePayload,
  planFlexibleDates,
  validateDateRange,
} from "../../worker/src/airbnb.js";
import {
  availabilityInputSchema,
  searchFlexibleStaysInputSchema,
  searchStaysInputSchema,
} from "../../worker/src/schemas.js";

describe("buildSearchFilters", () => {
  it("serializes agent-friendly location, date, guest, price, and capability filters", () => {
    const input = searchStaysInputSchema.parse({
      location: "Tampa, Florida",
      check_in: "2026-07-17",
      check_out: "2026-07-19",
      adults: 2,
      children: 1,
      pets: 1,
      price_min: 100,
      price_max: 500,
      room_types: ["Entire home/apt"],
      amenity_ids: [4, 7],
      property_type_ids: [1, 2],
      accessibility_feature_ids: [110],
      free_cancellation: true,
      instant_book: true,
      superhost: true,
      min_bedrooms: 2,
      min_beds: 3,
      min_bathrooms: 1.5,
      limit: 12,
    });
    const params = buildSearchFilters(input, {
      label: "Tampa, Florida, United States",
      placeId: "tampa-place",
      bounds: {
        northeast_latitude: 28.17,
        northeast_longitude: -82.25,
        southwest_latitude: 27.81,
        southwest_longitude: -82.65,
      },
    });
    const byName = new Map(params.map((param) => [param.filterName, param.filterValues]));

    expect(byName.get("query")).toEqual(["Tampa, Florida, United States"]);
    expect(byName.get("placeId")).toEqual(["tampa-place"]);
    expect(byName.get("priceFilterNumNights")).toEqual(["2"]);
    expect(byName.get("itemsPerGrid")).toEqual(["12"]);
    expect(byName.get("price_min")).toEqual(["100"]);
    expect(byName.get("price_max")).toEqual(["500"]);
    expect(byName.get("room_types")).toEqual(["Entire home/apt"]);
    expect(byName.get("amenities")).toEqual(["4", "7"]);
    expect(byName.get("l2_property_type_ids")).toEqual(["1", "2"]);
    expect(byName.get("accessibility_features")).toEqual(["110"]);
    expect(byName.get("flexible_cancellation")).toEqual(["true"]);
    expect(byName.get("ib")).toEqual(["true"]);
    expect(byName.get("superhost")).toEqual(["true"]);
    expect(JSON.stringify(params)).not.toContain("Galapagos");
    expect(JSON.stringify(params)).not.toContain("2024-02-01");
  });
});

describe("date planning", () => {
  it("validates exact date ranges", () => {
    expect(validateDateRange("2026-07-17", "2026-07-19")).toBe(2);
    expect(() => validateDateRange("2026-07-19", "2026-07-17")).toThrow(
      "check_out must be 1 to 365 days after check_in",
    );
  });

  it("selects requested weekdays and trip lengths within a strict fan-out budget", () => {
    const input = searchFlexibleStaysInputSchema.parse({
      location: "Tampa",
      earliest_check_in: "2026-07-10",
      latest_check_in: "2026-07-25",
      preferred_check_in_days: [5],
      nights: [2, 3],
      max_date_combinations: 3,
    });
    expect(planFlexibleDates(input)).toEqual([
      { check_in: "2026-07-10", check_out: "2026-07-12" },
      { check_in: "2026-07-17", check_out: "2026-07-20" },
      { check_in: "2026-07-24", check_out: "2026-07-26" },
    ]);
  });

  it("rejects duplicate trip lengths before flexible fan-out", () => {
    expect(() =>
      searchFlexibleStaysInputSchema.parse({
        location: "Tampa",
        earliest_check_in: "2026-07-10",
        latest_check_in: "2026-07-25",
        nights: [2, 2],
      }),
    ).toThrow("Trip lengths must be unique");
  });
});

describe("agent input validation", () => {
  it("rejects impossible calendar dates", () => {
    expect(() =>
      searchStaysInputSchema.parse({
        location: "Tampa",
        check_in: "2026-02-30",
        check_out: "2026-03-02",
      }),
    ).toThrow();
    expect(() =>
      availabilityInputSchema.parse({
        listing_id: "123",
        start_month: "2026-13",
      }),
    ).toThrow();
  });

  it("requires a location selector and an ordered price range", () => {
    expect(() =>
      searchStaysInputSchema.parse({
        check_in: "2026-07-17",
        check_out: "2026-07-19",
      }),
    ).toThrow("Provide location, place_id, or bounds");
    expect(() =>
      searchStaysInputSchema.parse({
        location: "Tampa",
        check_in: "2026-07-17",
        check_out: "2026-07-19",
        price_min: 500,
        price_max: 100,
      }),
    ).toThrow("price_min must be less than or equal to price_max");
  });
});

describe("localized display number parsing", () => {
  it.each([
    ["$1,448", 1448],
    ["€1.448,50", 1448.5],
    ["1 448,50 €", 1448.5],
    ["$99.25", 99.25],
    ["5.0 (13)", 5],
    ["4,9", 4.9],
    ["", null],
  ])("parses %s", (value, expected) => {
    expect(parseDisplayNumber(value)).toBe(expected);
  });
});

describe("search price normalization", () => {
  it("keeps a per-night primary value and uses the secondary total", () => {
    expect(
      normalizeSearchPrice("$200", "$430", "per night", "", 2),
    ).toEqual({ total: 430, nightly: 200 });
  });

  it("derives nightly price from a total-only value", () => {
    expect(
      normalizeSearchPrice("$401", "", "for 2 nights", "TOTAL_ONLY", 2),
    ).toEqual({ total: 401, nightly: 200.5 });
  });
});

describe("upstream payload integrity", () => {
  const quoteInput = {
    listing_id: "123",
    check_in: "2026-07-17",
    check_out: "2026-07-19",
    adults: 2,
    children: 0,
    infants: 0,
    pets: 0,
    currency: "USD",
    language: "en",
    require_fresh: false,
  };

  it("rejects GraphQL and missing-section quote responses", () => {
    expect(() => parseQuotePayload({ errors: [{ message: "bad hash" }] }, quoteInput)).toThrow(
      "Airbnb quote response included errors",
    );
    expect(() =>
      parseQuotePayload(
        {
          data: {
            presentation: {
              stayProductDetailPage: { sections: { sections: [] } },
            },
          },
        },
        quoteInput,
      ),
    ).toThrow("Airbnb quote response was incomplete");
  });

  it("rejects missing availability calendars instead of caching an empty answer", () => {
    expect(() => parseAvailabilityPayload({ errors: [{ message: "bad hash" }] })).toThrow(
      "Airbnb availability response included errors",
    );
    expect(() => parseAvailabilityPayload({ data: { merlin: {} } })).toThrow(
      "Airbnb availability response was incomplete",
    );
  });
});
