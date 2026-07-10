export interface AirbnbListingCardData {
  id: string;
  url: string;
  name: string;
  location: { latitude: number; longitude: number };
  price: {
    currency: string;
    total: number | null;
    nightly: number | null;
  };
  rating: number | null;
  images: Array<{ url: string; alt: string }>;
  guest_favorite: boolean;
  check_in: string;
  check_out: string;
  nights: number;
}

export interface AirbnbSearchResult {
  listings: AirbnbListingCardData[];
  total_returned: number;
  cache: "hit" | "miss" | "stale" | "bypass";
  timing_ms: number;
}

const AirbnbSearchResultSchema = z.object({
  listings: z.array(
    z.object({
      id: z.string(),
      url: z.string().url(),
      name: z.string(),
      location: z.object({ latitude: z.number(), longitude: z.number() }),
      price: z.object({
        currency: z.string(),
        total: z.number().nullable(),
        nightly: z.number().nullable(),
      }),
      rating: z.number().min(0).max(5).nullable(),
      images: z.array(z.object({ url: z.string().url(), alt: z.string() })),
      guest_favorite: z.boolean(),
      check_in: z.string(),
      check_out: z.string(),
      nights: z.number().int().positive(),
    }),
  ),
  total_returned: z.number().int().nonnegative(),
  cache: z.enum(["hit", "miss", "stale", "bypass"]),
  timing_ms: z.number().nonnegative(),
});

interface AirbnbListingGridProps {
  endpoint: string;
  query: Record<string, unknown>;
}

/**
 * Async React Server Component for Next.js App Router and other RSC hosts.
 * It consumes the same canonical JSON returned by the MCP search_stays tool.
 */
export async function AirbnbListingGrid({
  endpoint,
  query,
}: AirbnbListingGridProps) {
  const request: RequestInit & { next: { revalidate: number } } = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
    next: { revalidate: 300 },
  };
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/v1/stays/search`,
    request,
  );
  if (!response.ok) {
    throw new Error(`pyairbnb search failed with HTTP ${response.status}`);
  }
  const result = AirbnbSearchResultSchema.parse(await response.json());

  return (
    <section aria-label="Airbnb stays" className="pyairbnb-grid">
      {result.listings.map((listing) => (
        <article key={listing.id} className="pyairbnb-card">
          <a href={listing.url} target="_blank" rel="noreferrer">
            {listing.images[0] ? (
              <img
                src={listing.images[0].url}
                alt={listing.images[0].alt}
                width={640}
                height={480}
                loading="lazy"
              />
            ) : null}
            <div className="pyairbnb-card__body">
              {listing.guest_favorite ? <span>Guest favorite</span> : null}
              <h3>{listing.name}</h3>
              <p>
                {listing.price.total === null
                  ? "Price unavailable"
                  : new Intl.NumberFormat("en", {
                      style: "currency",
                      currency: listing.price.currency,
                    }).format(listing.price.total)}{" "}
                total · {listing.nights} night{listing.nights === 1 ? "" : "s"}
              </p>
              <p>{listing.rating === null ? "No rating shown" : `★ ${listing.rating}`}</p>
            </div>
          </a>
        </article>
      ))}
    </section>
  );
}
import { z } from "zod";
