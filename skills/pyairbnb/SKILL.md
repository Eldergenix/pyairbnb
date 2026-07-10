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
| Confirmed total for one chosen stay | `get_listing_quote` |
| Month/day calendar constraints | `get_listing_availability` |

Minimum argument shapes:

- `resolve_location`: `{query, language?, currency?, limit?}`
- `search_stays`: `{location? | place_id?/bounds?, check_in, check_out, adults?, children?, infants?, pets?, price_min?, price_max?, room_types?, amenity_ids?, property_type_ids?, accessibility_feature_ids?, free_cancellation?, instant_book?, superhost?, min_bedrooms?, min_beds?, min_bathrooms?, min_rating?, min_reviews?, currency?, language?, sort?, limit?, cursor?, require_fresh?}`
- `search_flexible_stays`: the same filters plus `{earliest_check_in, latest_check_in, nights?: number[], preferred_check_in_days?: 0..6[], max_date_combinations?: 1..6}`; omit exact dates and cursor.
- `get_listing_quote`: `{listing_id, check_in, check_out, adults?, children?, infants?, pets?, currency?}`
- `get_listing_availability`: `{listing_id, start_month: "YYYY-MM", months?: 1..6}`

Defaults are 1 adult, 0 pets, USD, 20 results, and recommended sort. `pets` is
a count. `price_max` is an inclusive nightly filter; clarify currency when `$`
is ambiguous. `place_id` or `bounds` works alone, but pass both after resolving.
The server applies sort before returning cached or live cards, and the tool's UI
resource renders the carousel automatically on compatible hosts.

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

Stay searches have day-level inventory, not time-of-day inventory. Use
time-of-day only for a separate experiences tool if one is available.

## Compact result

Show photo, name, dates, nightly and total price, rating, badges, and Airbnb
link. Surface assumptions and stale/partial warnings in one short line.

## Common mistakes

- Wrong: `room_type`, `max_nightly_price`, `sort_by`, or exact dates passed to
  `get_listing_availability`.
- Slow: quoting/calendar-fetching every search result.
- Misleading: calling a cached first page globally cheapest or guaranteed live.
