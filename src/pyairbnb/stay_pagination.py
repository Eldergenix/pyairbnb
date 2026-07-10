"""Bounded, deadline-aware pagination for Airbnb stay searches."""

from collections.abc import Callable
from itertools import count
import math
import time

import pyairbnb.api as api
import pyairbnb.search as search
import pyairbnb.standardize as standardize
import pyairbnb.utils as utils
from pyairbnb.utils import Timeout


DEFAULT_MAX_PAGES: int | None = None


def validate_pagination(
    limit: int | None,
    max_pages: int | None,
    deadline: float | None,
) -> None:
    if limit is not None:
        if isinstance(limit, bool) or not isinstance(limit, int):
            raise TypeError("limit must be an integer or None")
        if limit < 0:
            raise ValueError("limit must be greater than or equal to zero")
    if max_pages is not None:
        if isinstance(max_pages, bool) or not isinstance(max_pages, int):
            raise TypeError("max_pages must be an integer or None")
        if max_pages <= 0:
            raise ValueError("max_pages must be greater than zero")
    if deadline is not None:
        if isinstance(deadline, bool) or not isinstance(deadline, (int, float)):
            raise TypeError("deadline must be a number of seconds or None")
        if not math.isfinite(deadline):
            raise ValueError("deadline must be finite")
        if deadline <= 0:
            raise ValueError("deadline must be greater than zero")


def deadline_at(deadline: float | None) -> float | None:
    return None if deadline is None else time.monotonic() + deadline


def remaining(deadline_timestamp: float | None) -> float | None:
    if deadline_timestamp is None:
        return None
    return deadline_timestamp - time.monotonic()


def bounded_timeout(timeout: Timeout, seconds: float | None) -> Timeout:
    if seconds is None:
        return timeout
    seconds = max(0.001, seconds)
    if timeout is None:
        return seconds
    if isinstance(timeout, tuple):
        return min(sum(float(value) for value in timeout), seconds)
    return min(float(timeout), seconds)


def paginate_stays(
    fetch_page: Callable[[str, float | None], dict],
    *, limit: int | None, max_pages: int | None,
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
        raw_page = fetch_page(cursor, seconds)
        page = standardize.from_search(raw_page)
        if not page:
            break
        if limit is not None:
            page = page[: limit - len(results)]
        results.extend(page)
        pagination = utils.get_nested_value(
            raw_page,
            "data.presentation.staysSearch.results.paginationInfo",
            {},
        )
        next_cursor = pagination.get("nextPageCursor")
        if (
            (limit is not None and len(results) >= limit)
            or not next_cursor
            or next_cursor in seen_cursors
        ):
            break
        cursor = next_cursor
    return results


def _page_sized_filters(
    raw_params: list[dict[str, list[str]]],
    limit: int | None,
) -> tuple[list[dict[str, list[str]]], int]:
    page_size = min(limit, 50) if limit is not None else 50
    if page_size >= 50:
        return raw_params, page_size
    adjusted = []
    for param in raw_params:
        values = list(param["filterValues"])
        if param["filterName"] == "itemsPerGrid":
            try:
                configured_size = int(values[0])
            except (IndexError, TypeError, ValueError):
                configured_size = page_size
            if configured_size > 0:
                page_size = min(page_size, configured_size)
            values = [str(page_size)]
        adjusted.append(
            {"filterName": param["filterName"], "filterValues": values}
        )
    return adjusted, page_size


def search_with_raw_params(
    raw_params: list[dict[str, list[str]]], *, currency: str,
    language: str, proxy_url: str, hash: str, timeout: Timeout,
    api_key: str, limit: int | None, max_pages: int | None,
    deadline: float | None,
) -> list:
    validate_pagination(limit, max_pages, deadline)
    if limit == 0:
        return []
    raw_params, page_size = _page_sized_filters(raw_params, limit)
    deadline_timestamp = deadline_at(deadline)
    seconds = remaining(deadline_timestamp)
    if seconds is not None and seconds <= 0:
        return []
    request_timeout = bounded_timeout(timeout, seconds)
    resolved_api_key = api_key or api.get(proxy_url, timeout=request_timeout)

    def fetch_page(cursor: str, seconds_left: float | None) -> dict:
        return search.get(
            api_key=resolved_api_key, cursor=cursor,
            check_in=None, check_out=None,
            ne_lat=None, ne_long=None, sw_lat=None, sw_long=None,
            zoom_value=None, currency=currency, place_type="",
            price_min=0, price_max=0, amenities=None,
            free_cancellation=False, adults=0, children=0, infants=0,
            min_bedrooms=0, min_beds=0, min_bathrooms=0,
            language=language, proxy_url=proxy_url, hash=hash,
            raw_params=raw_params,
            timeout=bounded_timeout(timeout, seconds_left),
            max_map_items=page_size,
        )

    return paginate_stays(
        fetch_page,
        limit=limit,
        max_pages=max_pages,
        deadline_timestamp=deadline_timestamp,
    )
