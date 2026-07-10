# ruff: noqa: F401
"""Compatibility facade for pyairbnb's high-level orchestration APIs."""

from collections.abc import Callable, Iterable, Mapping
from datetime import date, datetime
from itertools import count
import math
import time
from urllib.parse import urlparse

import pyairbnb.api as api
import pyairbnb.calendarinfo as calendar
import pyairbnb.details as details
import pyairbnb.experience as experience
import pyairbnb.host_details as host_details
import pyairbnb.listing_details as _listing_details
import pyairbnb.price as price
import pyairbnb.reviews as reviews
import pyairbnb.search as search
import pyairbnb.standardize as standardize
import pyairbnb.stay_pagination as _stay_pagination
import pyairbnb.utils as utils
from pyairbnb.experience_search import (
    search_experience_by_taking_the_first_inputs_i_dont_care,
)
from pyairbnb.listing_details import (
    get_calendar,
    get_reviews,
    quote_date as _quote_date,
)
from pyairbnb.stay_pagination import DEFAULT_MAX_PAGES
from pyairbnb.stay_search import (
    search_all,
    search_all_from_url,
    search_first_page,
)
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


def _validate_pagination(
    limit: int | None,
    max_pages: int | None,
    deadline: float | None,
) -> None:
    _stay_pagination.validate_pagination(limit, max_pages, deadline)


def _deadline_at(deadline: float | None) -> float | None:
    return _stay_pagination.deadline_at(deadline)


def _remaining(deadline_at: float | None) -> float | None:
    return _stay_pagination.remaining(deadline_at)


def _bounded_timeout(timeout: Timeout, remaining: float | None) -> Timeout:
    return _stay_pagination.bounded_timeout(timeout, remaining)


def _paginate_stays(
    fetch_page: Callable[[str, float | None], dict],
    *, limit: int | None, max_pages: int | None,
    deadline_at: float | None,
) -> list:
    return _stay_pagination.paginate_stays(
        fetch_page,
        limit=limit,
        max_pages=max_pages,
        deadline_timestamp=deadline_at,
    )


def _search_with_raw_params(
    raw_params: list[dict[str, list[str]]], *, currency: str,
    language: str, proxy_url: str, hash: str, timeout: Timeout,
    api_key: str, limit: int | None, max_pages: int | None,
    deadline: float | None,
) -> list:
    return _stay_pagination.search_with_raw_params(
        raw_params,
        currency=currency,
        language=language,
        proxy_url=proxy_url,
        hash=hash,
        timeout=timeout,
        api_key=api_key,
        limit=limit,
        max_pages=max_pages,
        deadline=deadline,
    )


def get_details(
    room_url: str | None = None,
    room_id: int | None = None,
    domain: str = "www.airbnb.com",
    check_in: str | date | datetime | None = None,
    check_out: str | date | datetime | None = None,
    adults: int = 1,
    currency: str = "USD",
    language: str = "en",
    proxy_url: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT,
):
    """Return listing metadata enriched with reviews, calendar, and quote."""
    return _listing_details.get_details(
        room_url=room_url,
        room_id=room_id,
        domain=domain,
        check_in=check_in,
        check_out=check_out,
        adults=adults,
        currency=currency,
        language=language,
        proxy_url=proxy_url,
        timeout=timeout,
        calendar_getter=get_calendar,
    )
