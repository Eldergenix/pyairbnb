import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeExperience } from "../../worker/src/airbnb/experiences.js";
import { computeFacets } from "../../worker/src/airbnb/facets.js";
import {
  canonicalCacheRequest,
  configureCacheBindings,
  readThroughCache,
} from "../../worker/src/cache.js";
import { UpstreamError } from "../../worker/src/errors.js";
import { compactTextPayload } from "../../worker/src/index.js";
import type { ListingCard } from "../../worker/src/schemas.js";

function card(overrides: Partial<ListingCard>): ListingCard {
  return {
    id: "1",
    url: "https://www.airbnb.com/rooms/1",
    name: "Stay",
    location: { latitude: 0, longitude: 0 },
    price: { currency: "USD", total: 200, nightly: 100, display: "$200", qualifier: "total" },
    rating: 4.8,
    review_count: 10,
    images: [],
    badges: [],
    guest_favorite: false,
    check_in: "2026-08-01",
    check_out: "2026-08-03",
    nights: 2,
    source: "airbnb",
    ...overrides,
  };
}

describe("computeFacets", () => {
  it("summarizes price percentiles, rating, favorites, and badges", () => {
    const listings = [
      card({ id: "a", price: { currency: "USD", total: 200, nightly: 100, display: "", qualifier: "" }, rating: 4.5, guest_favorite: true, badges: ["Guest favorite"] }),
      card({ id: "b", price: { currency: "USD", total: 400, nightly: 200, display: "", qualifier: "" }, rating: 5, badges: ["Guest favorite"] }),
      card({ id: "c", price: { currency: "USD", total: 600, nightly: 300, display: "", qualifier: "" }, rating: null }),
    ];
    const facets = computeFacets(listings, "USD");
    expect(facets.count).toBe(3);
    expect(facets.price).toMatchObject({ currency: "USD", basis: "nightly", counted: 3, min: 100, median: 200, max: 300 });
    expect(facets.rating).toMatchObject({ counted: 2, average: 4.75 });
    expect(facets.guest_favorites).toBe(1);
    expect(facets.top_badges).toContainEqual({ label: "Guest favorite", count: 2 });
  });

  it("handles empty and price-less listings without throwing", () => {
    expect(computeFacets([], "EUR")).toMatchObject({ count: 0, price: { counted: 0, min: null, median: null } });
    const noPrice = [card({ price: { currency: "USD", total: null, nightly: null, display: "", qualifier: "" } })];
    expect(computeFacets(noPrice, "USD").price.counted).toBe(0);
  });
});

describe("compactTextPayload detail levels", () => {
  const payload = {
    query: { location: "Tampa" },
    facets: { count: 1 },
    queries: [{ label: "Tampa" }],
    listings: [
      {
        id: "123",
        name: "Example",
        url: "https://www.airbnb.com/rooms/123",
        images: [{ url: "https://a0.muscache.com/x.jpg" }],
        location: { latitude: 1, longitude: 2 },
        price: { currency: "USD", total: 300, nightly: 150 },
        rating: 4.9,
        review_count: 20,
        guest_favorite: true,
        check_in: "2026-07-17",
        check_out: "2026-07-19",
        nights: 2,
      },
    ],
    schema_version: "1.0",
  };

  it("standard drops media/coordinates but keeps facets and queries", () => {
    const out = JSON.stringify(compactTextPayload(payload, "standard"));
    expect(out).toContain('"id":"123"');
    expect(out).not.toContain("muscache");
    expect(out).not.toContain("latitude");
    expect(out).toContain('"facets"');
    expect(out).toContain('"queries"');
  });

  it("compact reduces each card to price and rating", () => {
    const out = compactTextPayload(payload, "compact") as { listings: Record<string, unknown>[] };
    expect(out.listings[0]).toMatchObject({ id: "123", nightly: 150, total: 300, rating: 4.9 });
    expect(out.listings[0]).not.toHaveProperty("url");
  });

  it("full returns the value untouched", () => {
    expect(compactTextPayload(payload, "full")).toBe(payload);
  });

  it("leaves non-card listing arrays (comparison rows) intact", () => {
    const compare = { listings: [{ listing_id: "9", available: true, cache: "miss" }], nights: 2 };
    expect(compactTextPayload(compare, "standard")).toMatchObject({
      listings: [{ listing_id: "9", available: true }],
      nights: 2,
    });
  });
});

describe("normalizeExperience", () => {
  // Shape captured from a live ExperiencesSearch response.
  const raw = {
    __typename: "ExperienceSearchResult",
    id: "4527793",
    title: "Sunset Sail in Barcelona",
    avgRatingLocalized: "4.89 (1,363)",
    kickerText: "2 hours",
    lat: 41.3666,
    lng: 2.1903,
    displayPrice: { primaryLine: { __typename: "OrderedDisplayPriceLine" } },
    posterPictures: [{ poster: "https://a0.muscache.com/im/pictures/x.jpg" }],
  };

  it("extracts id, title, rating, review count, duration, coordinates, and photo", () => {
    const card = normalizeExperience(raw);
    expect(card).toMatchObject({
      id: "4527793",
      url: "https://www.airbnb.com/experiences/4527793",
      title: "Sunset Sail in Barcelona",
      rating: 4.89,
      review_count: 1363,
      duration: "2 hours",
      coordinates: { latitude: 41.3666, longitude: 2.1903 },
      photo: "https://a0.muscache.com/im/pictures/x.jpg",
    });
    // The search feed omits price and per-slot times.
    expect(card?.price.amount).toBeNull();
    expect(card?.start_times).toEqual([]);
  });

  it("rejects malformed results", () => {
    expect(normalizeExperience({ id: "", title: "" })).toBeNull();
    expect(normalizeExperience(null)).toBeNull();
  });
});

describe("KV L2 cache tier", () => {
  afterEach(() => configureCacheBindings(undefined, undefined));

  it("writes fresh values through to the KV L2 namespace", async () => {
    configureCacheBindings(env.CACHE_KV, undefined);
    const request = await canonicalCacheRequest("test-l2-write-v1", "wkey");
    const kvKey = new URL(request.url).pathname.slice(1);
    const ctx = createExecutionContext();
    await readThroughCache({
      namespace: "test-l2-write-v1",
      key: "wkey",
      freshTtlSeconds: 300,
      staleTtlSeconds: 3600,
      requireFresh: false,
      ctx,
      load: async () => ({ value: 99 }),
    });
    await waitOnExecutionContext(ctx);
    const stored = (await env.CACHE_KV.get(kvKey, "json")) as {
      value: { value: number };
    } | null;
    expect(stored?.value).toEqual({ value: 99 });
  });

  it("serves an L2 entry when the colo cache is empty and skips origin", async () => {
    const request = await canonicalCacheRequest("test-l2-serve-v1", "skey");
    const kvKey = new URL(request.url).pathname.slice(1);
    const now = Date.now();
    await env.CACHE_KV.put(
      kvKey,
      JSON.stringify({
        value: "from-l2",
        fetchedAt: new Date(now).toISOString(),
        freshUntil: now + 60_000,
        staleUntil: now + 120_000,
      }),
    );
    configureCacheBindings(env.CACHE_KV, undefined);
    let loads = 0;
    const ctx = createExecutionContext();
    const result = await readThroughCache<string>({
      namespace: "test-l2-serve-v1",
      key: "skey",
      freshTtlSeconds: 60,
      staleTtlSeconds: 120,
      requireFresh: false,
      ctx,
      load: async () => {
        loads += 1;
        return "from-origin";
      },
    });
    await waitOnExecutionContext(ctx);
    expect(result.value).toBe("from-l2");
    expect(loads).toBe(0);
  });
});

describe("negative caching", () => {
  it("caches a transient upstream failure and fails fast without reloading", async () => {
    let loads = 0;
    const load = async () => {
      loads += 1;
      throw new UpstreamError("upstream_timeout", "timed out", 504);
    };
    const firstCtx = createExecutionContext();
    await expect(
      readThroughCache({
        namespace: "test-negative-v1",
        key: "neg-key",
        freshTtlSeconds: 60,
        staleTtlSeconds: 120,
        requireFresh: false,
        negativeTtlSeconds: 60,
        ctx: firstCtx,
        load,
      }),
    ).rejects.toThrow("timed out");
    await waitOnExecutionContext(firstCtx);

    const secondCtx = createExecutionContext();
    await expect(
      readThroughCache({
        namespace: "test-negative-v1",
        key: "neg-key",
        freshTtlSeconds: 60,
        staleTtlSeconds: 120,
        requireFresh: false,
        negativeTtlSeconds: 60,
        ctx: secondCtx,
        load,
      }),
    ).rejects.toThrow("timed out");
    await waitOnExecutionContext(secondCtx);

    expect(loads).toBe(1);
  });
});
