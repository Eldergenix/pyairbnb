"""Location resolution and bounded pagination for Airbnb experiences."""

from itertools import count

import pyairbnb.experience as experience
import pyairbnb.search as search
import pyairbnb.utils as utils
from pyairbnb.stay_pagination import (
    DEFAULT_MAX_PAGES,
    bounded_timeout,
    deadline_at,
    remaining,
    validate_pagination,
)
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


def _resolve_place(
    user_input_text: str,
    currency: str,
    locale: str,
    api_key: str,
    proxy_url: str,
    timeout: Timeout,
    deadline_timestamp: float | None,
) -> tuple[str, str] | None:
    seconds = remaining(deadline_timestamp)
    if seconds is not None and seconds <= 0:
        return None
    markets_data = search.get_markets(
        currency, locale, api_key, proxy_url,
        timeout=bounded_timeout(timeout, seconds),
    )
    markets = utils.get_nested_value(markets_data, "user_markets", [])
    if not markets:
        raise Exception("markets are empty")
    config_token = utils.get_nested_value(markets[0], "satori_parameters", "")
    country_code = utils.get_nested_value(markets[0], "country_code", "")
    if not config_token or not country_code:
        raise Exception("config_token or country_code are empty")
    seconds = remaining(deadline_timestamp)
    if seconds is not None and seconds <= 0:
        return None
    places = search.get_places_ids(
        country_code, user_input_text, currency, locale, config_token,
        api_key, proxy_url, timeout=bounded_timeout(timeout, seconds),
    )
    if not places:
        raise Exception("empty places ids")
    place_id = utils.get_nested_value(
        places[0], "location.google_place_id", ""
    )
    location_name = utils.get_nested_value(
        places[0], "location.location_name", ""
    )
    if not place_id or not location_name:
        raise Exception("place_id or location_name are empty")
    return place_id, location_name


def _experience_pages(
    place: tuple[str, str], currency: str, locale: str,
    check_in: str, check_out: str, api_key: str, proxy_url: str,
    timeout: Timeout, limit: int | None, max_pages: int | None,
    deadline_timestamp: float | None,
) -> list:
    results = []
    cursor = ""
    seen_cursors: set[str] = set()
    pages = range(max_pages) if max_pages is not None else count()
    for _ in pages:
        if limit is not None and len(results) >= limit:
            break
        seconds = remaining(deadline_timestamp)
        if seconds is not None and seconds <= 0:
            break
        seen_cursors.add(cursor)
        page, next_cursor = experience.search_by_place_id(
            cursor, place[0], place[1], currency, locale, check_in, check_out,
            api_key, proxy_url, timeout=bounded_timeout(timeout, seconds),
        )
        if not page:
            break
        if limit is not None:
            page = page[: limit - len(results)]
        results.extend(page)
        if not next_cursor or next_cursor in seen_cursors:
            break
        cursor = next_cursor
    return results


def search_experience_by_taking_the_first_inputs_i_dont_care(
    user_input_text: str, currency: str, locale: str,
    check_in: str, check_out: str, api_key: str, proxy_url: str,
    timeout: Timeout = DEFAULT_TIMEOUT, *, limit: int | None = None,
    max_pages: int | None = DEFAULT_MAX_PAGES,
    deadline: float | None = None,
):
    validate_pagination(limit, max_pages, deadline)
    if limit == 0:
        return []
    deadline_timestamp = deadline_at(deadline)
    place = _resolve_place(
        user_input_text, currency, locale, api_key, proxy_url, timeout,
        deadline_timestamp,
    )
    if place is None:
        return []
    return _experience_pages(
        place, currency, locale, check_in, check_out, api_key, proxy_url,
        timeout, limit, max_pages, deadline_timestamp,
    )
