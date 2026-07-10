import type { ListingCard, SearchFacets } from "../schemas.js";

function percentile(sortedAscending: number[], fraction: number): number | null {
  if (sortedAscending.length === 0) return null;
  if (sortedAscending.length === 1) return sortedAscending[0] ?? null;
  const position = fraction * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedAscending[lowerIndex];
  const upper = sortedAscending[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  const weight = position - lowerIndex;
  return Math.round((lower + (upper - lower) * weight) * 100) / 100;
}

/**
 * Compute a compact statistical summary over a page of listing cards so an
 * agent can reason about the whole set (price spread, rating, badges) in one
 * turn instead of paginating. Nightly price is the comparison basis because a
 * single search shares check-in/out across every card.
 */
export function computeFacets(
  listings: ListingCard[],
  currency: string,
): SearchFacets {
  const nightlyPrices = listings
    .map((listing) => listing.price.nightly)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const ratings = listings
    .map((listing) => listing.rating)
    .filter((value): value is number => value !== null);
  const badgeCounts = new Map<string, number>();
  for (const listing of listings) {
    for (const badge of listing.badges) {
      const label = badge.trim();
      if (label) badgeCounts.set(label, (badgeCounts.get(label) ?? 0) + 1);
    }
  }
  const averageRating =
    ratings.length > 0
      ? Math.round(
          (ratings.reduce((sum, value) => sum + value, 0) / ratings.length) *
            100,
        ) / 100
      : null;
  return {
    count: listings.length,
    price: {
      currency,
      basis: "nightly",
      counted: nightlyPrices.length,
      min: nightlyPrices[0] ?? null,
      p25: percentile(nightlyPrices, 0.25),
      median: percentile(nightlyPrices, 0.5),
      p75: percentile(nightlyPrices, 0.75),
      max: nightlyPrices[nightlyPrices.length - 1] ?? null,
    },
    rating: { counted: ratings.length, average: averageRating },
    guest_favorites: listings.filter((listing) => listing.guest_favorite)
      .length,
    top_badges: [...badgeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count })),
  };
}
