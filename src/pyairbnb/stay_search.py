"""Public orchestration entry points for stay searches."""

from collections.abc import Iterable, Mapping
from datetime import date, datetime

import pyairbnb.search as search
from pyairbnb.stay_pagination import DEFAULT_MAX_PAGES, search_with_raw_params
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


_FILTER_ARGUMENTS = (
    "check_in", "check_out", "ne_lat", "ne_long", "sw_lat", "sw_long",
    "zoom_value", "query", "place_id", "place_type", "room_types",
    "price_min", "price_max", "amenities", "free_cancellation", "adults",
    "children", "infants", "pets", "min_bedrooms", "min_beds",
    "min_bathrooms", "property_type_ids", "accessibility_features",
    "instant_book", "superhost", "extra_filters",
)


def _search(
    arguments: Mapping[str, object],
    raw_params: list[dict[str, list[str]]],
    max_pages: int | None,
) -> list:
    return search_with_raw_params(
        raw_params,
        currency=arguments["currency"],
        language=arguments["language"],
        proxy_url=arguments["proxy_url"],
        hash=arguments["hash"],
        timeout=arguments["timeout"],
        api_key=arguments["api_key"],
        limit=arguments["limit"],
        max_pages=max_pages,
        deadline=arguments["deadline"],
    )


def _filters(arguments: Mapping[str, object]) -> list[dict[str, list[str]]]:
    return search.build_search_filters(
        **{name: arguments[name] for name in _FILTER_ARGUMENTS}
    )


def search_all(
    check_in: str | date | datetime | None = None,
    check_out: str | date | datetime | None = None,
    ne_lat: float | None = None, ne_long: float | None = None,
    sw_lat: float | None = None, sw_long: float | None = None,
    zoom_value: int | None = None,
    price_min: int | float = 0, price_max: int | float = 0,
    place_type: str = "", amenities: Iterable[int | str] | None = None,
    free_cancellation: bool = False,
    adults: int = 0, children: int = 0, infants: int = 0,
    min_bedrooms: int = 0, min_beds: int = 0,
    min_bathrooms: int | float = 0, currency: str = "USD",
    language: str = "en", proxy_url: str = "", hash: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT, *, query: str | None = None,
    place_id: str | None = None, room_types: Iterable[str] | None = None,
    pets: int = 0,
    property_type_ids: Iterable[int | str] | None = None,
    accessibility_features: Iterable[int | str] | None = None,
    instant_book: bool = False, superhost: bool = False,
    extra_filters: Mapping[str, Iterable[object] | object] | None = None,
    api_key: str = "", limit: int | None = None,
    max_pages: int | None = DEFAULT_MAX_PAGES,
    deadline: float | None = None,
):
    """Return standardized stays within optional page, item, and time bounds."""
    arguments = locals()
    return _search(arguments, _filters(arguments), max_pages)


def search_first_page(
    check_in: str | date | datetime | None = None,
    check_out: str | date | datetime | None = None,
    ne_lat: float | None = None, ne_long: float | None = None,
    sw_lat: float | None = None, sw_long: float | None = None,
    zoom_value: int | None = None,
    price_min: int | float = 0, price_max: int | float = 0,
    place_type: str = "", amenities: Iterable[int | str] | None = None,
    free_cancellation: bool = False,
    adults: int = 0, children: int = 0, infants: int = 0,
    min_bedrooms: int = 0, min_beds: int = 0,
    min_bathrooms: int | float = 0, currency: str = "USD",
    language: str = "en", proxy_url: str = "", hash: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT, *, query: str | None = None,
    place_id: str | None = None, room_types: Iterable[str] | None = None,
    pets: int = 0,
    property_type_ids: Iterable[int | str] | None = None,
    accessibility_features: Iterable[int | str] | None = None,
    instant_book: bool = False, superhost: bool = False,
    extra_filters: Mapping[str, Iterable[object] | object] | None = None,
    api_key: str = "", limit: int | None = None,
    deadline: float | None = None,
):
    """Return only the first standardized page of matching stays."""
    arguments = locals()
    return _search(arguments, _filters(arguments), 1)


def search_all_from_url(
    url: str, currency: str = "USD", language: str = "en",
    proxy_url: str = "", hash: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT, *, api_key: str = "",
    limit: int | None = None,
    max_pages: int | None = DEFAULT_MAX_PAGES,
    deadline: float | None = None,
):
    """Forward every Airbnb search URL parameter into bounded pagination."""
    arguments = locals()
    return _search(arguments, search.url_to_raw_params(url), max_pages)
