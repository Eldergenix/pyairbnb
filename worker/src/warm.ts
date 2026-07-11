import { searchStays } from "./airbnb.js";
import { configureCacheBindings } from "./cache.js";
import { searchStaysInputSchema } from "./schemas.js";

// A small seed list of high-traffic destinations kept stale-warm so popular
// routes never fall back to a blocking cold miss. This is intentionally static;
// a later revision can source it from Analytics Engine popularity data.
const WARM_LOCATIONS = [
  "New York, New York",
  "Los Angeles, California",
  "Miami, Florida",
  "Las Vegas, Nevada",
  "Orlando, Florida",
  "San Francisco, California",
  "Chicago, Illinois",
  "Austin, Texas",
];

const DAY_MS = 86_400_000;

/** ISO date for the next Friday and the Sunday two nights later, from `now`. */
export function nextWeekend(now: number): { check_in: string; check_out: string } {
  const today = new Date(Math.floor(now / DAY_MS) * DAY_MS);
  const daysUntilFriday = (5 - today.getUTCDay() + 7) % 7 || 7;
  const friday = today.getTime() + daysUntilFriday * DAY_MS;
  return {
    check_in: new Date(friday).toISOString().slice(0, 10),
    check_out: new Date(friday + 2 * DAY_MS).toISOString().slice(0, 10),
  };
}

export async function warmPopularRoutes(
  env: Env,
  ctx: ExecutionContext,
  now: number,
): Promise<void> {
  configureCacheBindings(env.CACHE_KV, env.METRICS);
  const { check_in, check_out } = nextWeekend(now);
  const results = await Promise.allSettled(
    WARM_LOCATIONS.map((location) =>
      searchStays(
        searchStaysInputSchema.parse({
          location,
          check_in,
          check_out,
          adults: 2,
          limit: 20,
          require_fresh: true,
          prewarm: false,
        }),
        ctx,
      ),
    ),
  );
  const warmed = results.filter((result) => result.status === "fulfilled").length;
  console.log(
    JSON.stringify({
      message: "cron cache warm complete",
      warmed,
      total: WARM_LOCATIONS.length,
      check_in,
      check_out,
    }),
  );
}
