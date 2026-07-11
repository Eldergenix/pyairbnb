---
name: pyairbnb
description: Use when an agent needs fast Airbnb stay discovery, exact or flexible travel dates, location disambiguation, price filters, listing quotes, availability calendars, or compact listing-card UI through the pyairbnb MCP server.
---

# Using pyairbnb

## Overview

Use the remote MCP as the source of truth. Keep the first response fast and
compact; enrich only listings the user is actually considering.

## Tool choice

| Need | Tool |
|---|---|
| Ambiguous place or reusable bounds | `resolve_location` |
| Exact check-in/check-out | `search_stays` |
| Weekday/weekend window or several trip lengths | `search_flexible_stays` |
| Compare several cities/neighborhoods at once | `multi_search` |
| Price a shortlist of listings together | `compare_listings` |
| Activities, tours, or classes (time-of-day) | `search_experiences` |
| Full description, amenities, rules, host, photos | `get_listing_details` |
| Guest reviews and rating breakdown | `get_listing_reviews` |
| A host's other listings | `get_host_listings` |
| Confirmed total for one chosen stay | `get_listing_quote` |
| Month/day calendar constraints | `get_listing_availability` |

Minimum argument shapes:

- `resolve_location`: `{query, language?, currency?, limit?}`
- `search_stays`: `{location? | place_id?/bounds?, check_in, check_out, adults?, children?, infants?, pets?, price_min?, price_max?, room_types?, amenity_ids?, property_type_ids?, accessibility_feature_ids?, free_cancellation?, instant_book?, superhost?, min_bedrooms?, min_beds?, min_bathrooms?, min_rating?, min_reviews?, currency?, language?, sort?, limit?, cursor?, detail_level?, prewarm?, require_fresh?}`
- `search_flexible_stays`: the same filters plus `{earliest_check_in, latest_check_in, nights?: number[], preferred_check_in_days?: 0..6[], max_date_combinations?: 1..6}`; omit exact dates and cursor.
- `multi_search`: `{locations: string[1..5], check_in, check_out, adults?, price_min?, price_max?, room_types?, min_rating?, sort?, per_location_limit?, limit?, detail_level?}`; returns merged `listings`, a `facets` summary, and per-`queries` provenance.
- `compare_listings`: `{listing_ids: string[2..8], check_in, check_out, adults?, children?, infants?, pets?, currency?}`; returns per-listing price plus `cheapest_available_listing_id`.
- `search_experiences`: `{location, check_in?, check_out?, start_time_after?: "HH:MM", start_time_before?: "HH:MM", currency?, language?, limit?, cursor?}`; returns experiences with rating, duration, and coordinates. The feed omits per-slot start times and prices, so a time filter may return all matches with a warning — open the experience page for exact schedule and price.
- `get_listing_details`: `{listing_id, check_in?, check_out?, adults?, currency?, language?}`; add both dates to also return the price line.
- `get_listing_reviews`: `{listing_id, limit?: 1..50, offset?, currency?, language?}`; page with `next_offset`.
- `get_host_listings`: `{host_id, limit?: 1..50, currency?, language?}`.
- `get_listing_quote`: `{listing_id, check_in, check_out, adults?, children?, infants?, pets?, currency?}`
- `get_listing_availability`: `{listing_id, start_month: "YYYY-MM", months?: 1..6}`

Defaults are 1 adult, 0 pets, USD, 20 results, and recommended sort. `pets` is
a count. `price_max` is an inclusive nightly filter; clarify currency when `$`
is ambiguous. `place_id` or `bounds` works alone, but pass both after resolving.
The server applies sort before returning cached or live cards, and the tool's UI
resource renders the carousel automatically on compatible hosts. Read the
`facets` block on any search to answer price-range and rating questions in one
call. Prefer `compare_listings` over several `get_listing_quote` calls for a
shortlist, and `multi_search` over repeated `search_stays` across locations. Set
`detail_level: "compact"` to minimize tokens when returning many cards.

## Search rules

1. Resolve ambiguous locations. Pass `place_id` and `bounds` exactly as
   returned; never invent `location_id`.
2. Use ISO dates. For “next weekend,” state the interpreted dates. Ask before
   assuming a materially important guest count or which Springfield.
3. Use the actual schema names: `room_types`, `price_max`, `sort`, `amenity_ids`,
   `accessibility_feature_ids`, and `pets`. Entire-place value is
   `"Entire home/apt"`; ascending price sort is `"price_low_to_high"`.
4. Leave `require_fresh` false unless the user explicitly needs a live bypass.
   Respect `cache`, `freshness`, `warnings`, `sampled`, and `partial` in the
   result. `cache=mixed` means flexible child searches used different lanes;
   `sampled=true` means not every possible date combination was queried.
5. Render `structuredContent.listings` directly as cards. Keep at most 12 cards
   and 3 photos per visible card; do not narrate every field.
6. Quote only the top 1-3 candidates. A successful quote already evaluates
   exact-date availability; do not also fetch a monthly calendar unless the
   user asks about alternate days or minimum-night rules. Pass a card's `id`
   as the quote tool's `listing_id`.
7. Continue with `next_cursor` only when the user wants more inventory. Say
   “cheapest returned” unless pagination was exhausted.

Stay searches have day-level inventory, not time-of-day inventory. For
time-of-day activities use `search_experiences` with `start_time_after` /
`start_time_before`; if it warns that start times were unavailable, present the
returned experiences and point the user to the experience page for the schedule.

## Compact result

Show photo, name, dates, nightly and total price, rating, badges, and Airbnb
link. Surface assumptions and stale/partial warnings in one short line.

## Common mistakes

- Wrong: `room_type`, `max_nightly_price`, `sort_by`, or exact dates passed to
  `get_listing_availability`.
- Slow: quoting/calendar-fetching every search result.
- Misleading: calling a cached first page globally cheapest or guaranteed live.
