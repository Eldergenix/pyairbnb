import type { ListingCard, SearchStaysInput } from "../schemas.js";
import { getListingQuote } from "./quote.js";

const PREWARM_COUNT = 3;

/**
 * Background-warm the price-quote cache for the first few results of a search
 * so the agent's likely next step (get_listing_quote on a chosen card) is a
 * cache hit instead of a fresh origin fetch. Failures are swallowed; this is a
 * best-effort optimization that must never affect the search response.
 */
export function prewarmTopQuotes(
  listings: ListingCard[],
  input: SearchStaysInput,
  ctx: ExecutionContext,
): void {
  const targets = listings.slice(0, PREWARM_COUNT);
  if (targets.length === 0) return;
  ctx.waitUntil(
    Promise.allSettled(
      targets.map((listing) =>
        getListingQuote(
          {
            listing_id: listing.id,
            check_in: input.check_in,
            check_out: input.check_out,
            adults: input.adults,
            children: input.children,
            infants: input.infants,
            pets: input.pets,
            currency: input.currency,
            language: input.language,
            require_fresh: false,
          },
          ctx,
        ),
      ),
    ).then(() => undefined),
  );
}
