import type { ListingCard, SearchStaysInput } from "../schemas.js";
import { array, number, path, record, string } from "./payload.js";
import { parseDisplayNumber } from "./payload.js";

function decodeListingId(encoded: string): string {
  try {
    const decoded = atob(encoded);
    return decoded.match(/(\d+)$/)?.[1] ?? "";
  } catch {
    return "";
  }
}

export function normalizeSearchPrice(
  primaryDisplay: string,
  secondaryDisplay: string,
  primaryQualifier: string,
  displayStyle: string,
  nights: number,
): { total: number | null; nightly: number | null } {
  const primaryAmount = parseDisplayNumber(primaryDisplay);
  const secondaryAmount = parseDisplayNumber(secondaryDisplay);
  const qualifier = primaryQualifier.toLowerCase();
  const isNightly = /(?:per|\/|a)\s*night/.test(qualifier);
  const isTotal =
    !isNightly &&
    (qualifier.includes("total") ||
      /for\s+\d+\s+nights?/.test(qualifier) ||
      displayStyle.toUpperCase().includes("TOTAL"));
  const total = secondaryAmount ?? (isTotal ? primaryAmount : null);
  const nightly =
    primaryAmount === null
      ? total === null
        ? null
        : Math.round((total / nights) * 100) / 100
      : isTotal
        ? Math.round((primaryAmount / nights) * 100) / 100
        : primaryAmount;
  return { total, nightly };
}

function normalizePrice(
  result: Record<string, unknown>,
  input: SearchStaysInput,
  nights: number,
): ListingCard["price"] {
  const displayPrice = record(result.structuredDisplayPrice);
  const primary = record(displayPrice?.primaryLine);
  const secondary = record(displayPrice?.secondaryLine);
  const primaryDisplay =
    string(primary?.discountedPrice) ||
    string(primary?.price) ||
    string(primary?.originalPrice);
  const secondaryDisplay = string(secondary?.price);
  const primaryQualifier = string(primary?.qualifier);
  const { total, nightly } = normalizeSearchPrice(
    primaryDisplay,
    secondaryDisplay,
    primaryQualifier,
    string(displayPrice?.displayPriceStyle),
    nights,
  );
  return {
    currency: input.currency,
    total,
    nightly,
    display: secondaryDisplay || primaryDisplay,
    qualifier: string(secondary?.qualifier) || primaryQualifier,
  };
}

function normalizeRating(result: Record<string, unknown>): {
  rating: number | null;
  reviewCount: number | null;
} {
  const ratingText = string(result.avgRatingLocalized);
  const rating = parseDisplayNumber(ratingText);
  const reviewMatch = ratingText.match(/\((\d[\d,.]*)\)/);
  const reviewCount = reviewMatch?.[1]
    ? Number(reviewMatch[1].replace(/[,.]/g, ""))
    : null;
  return { rating, reviewCount };
}

function normalizeMedia(
  result: Record<string, unknown>,
  name: string,
): { images: ListingCard["images"]; badges: string[] } {
  const images = array(result.contextualPictures)
    .map((picture) => string(record(picture)?.picture))
    .filter(Boolean)
    .slice(0, 5)
    .map((url, index) => ({ url, alt: `${name} photo ${index + 1}` }));
  const badges = array(result.badges)
    .map(
      (badge) =>
        string(record(badge)?.text) ||
        string(path(badge, ["loggingContext", "badgeType"])),
    )
    .filter(Boolean);
  return { images, badges };
}

export function normalizeListing(
  value: unknown,
  input: SearchStaysInput,
  nights: number,
): ListingCard | null {
  const result = record(value);
  if (!result || string(result.__typename) !== "StaySearchResult") return null;
  const listing = record(result.demandStayListing);
  const id = decodeListingId(string(listing?.id));
  if (!id) return null;
  const coordinate = record(path(listing, ["location", "coordinate"]));
  const latitude = number(coordinate?.latitude);
  const longitude = number(coordinate?.longitude);
  if (latitude === null || longitude === null) return null;

  const name =
    string(
      path(listing, [
        "description",
        "name",
        "localizedStringWithTranslationPreference",
      ]),
    ) ||
    string(result?.title) ||
    `Airbnb stay ${id}`;
  const { rating, reviewCount } = normalizeRating(result);
  const { images, badges } = normalizeMedia(result, name);
  return {
    id,
    url: `https://www.airbnb.com/rooms/${id}?check_in=${input.check_in}&check_out=${input.check_out}`,
    name,
    location: { latitude, longitude },
    price: normalizePrice(result, input, nights),
    rating,
    review_count: reviewCount,
    images,
    badges,
    guest_favorite: badges.some((badge) =>
      badge.toLowerCase().includes("guest favorite"),
    ),
    check_in: input.check_in,
    check_out: input.check_out,
    nights,
    source: "airbnb",
  };
}

export function sortListings(
  listings: ListingCard[],
  sort: SearchStaysInput["sort"],
): ListingCard[] {
  const sorted = [...listings];
  if (sort === "price_low_to_high") {
    sorted.sort(
      (left, right) =>
        (left.price.total ?? Infinity) - (right.price.total ?? Infinity),
    );
  } else if (sort === "price_high_to_low") {
    sorted.sort(
      (left, right) => (right.price.total ?? -1) - (left.price.total ?? -1),
    );
  } else if (sort === "rating") {
    sorted.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1));
  }
  return sorted;
}
