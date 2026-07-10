"""HTTP transport for Airbnb's persisted ``StaysSearch`` operation."""

from collections.abc import Iterable, Mapping
from datetime import date, datetime
from urllib.parse import urlencode

from pyairbnb.api import get_http_session
from pyairbnb.search_filters import build_search_filters
from pyairbnb.search_operation import HEADERS
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


TREATMENT_FLAGS = [
    "feed_map_decouple_m11_treatment",
    "stays_search_rehydration_treatment_desktop",
    "stays_search_rehydration_treatment_moweb",
    "selective_query_feed_map_homepage_desktop_treatment",
    "selective_query_feed_map_homepage_moweb_treatment",
]
DEFAULT_OPERATION_ID = (
    "9f945886dcc032b9ef4ba770d9132eb0aa78053296b5405483944c229617b00b"
)
_FILTER_ARGUMENTS = (
    "check_in", "check_out", "ne_lat", "ne_long", "sw_lat", "sw_long",
    "zoom_value", "query", "place_id", "place_type", "room_types",
    "price_min", "price_max", "amenities", "free_cancellation", "adults",
    "children", "infants", "pets", "min_bedrooms", "min_beds",
    "min_bathrooms", "property_type_ids", "accessibility_features",
    "instant_book", "superhost", "extra_filters",
)


def _validated_map_size(max_map_items: int) -> None:
    if isinstance(max_map_items, bool) or not isinstance(max_map_items, int):
        raise TypeError("max_map_items must be an integer")
    if not 1 <= max_map_items <= 9999:
        raise ValueError("max_map_items must be between 1 and 9999")


def _raw_params(
    supplied: list[dict[str, list[str]]] | None,
    arguments: Mapping[str, object],
) -> list[dict[str, list[str]]]:
    if supplied is not None:
        return [
            {
                "filterName": param["filterName"],
                "filterValues": list(param["filterValues"]),
            }
            for param in supplied
        ]
    return build_search_filters(
        **{name: arguments[name] for name in _FILTER_ARGUMENTS}
    )


def _search_request(
    operation_id: str,
    cursor: str,
    raw_params: list[dict[str, list[str]]],
    max_map_items: int,
) -> dict:
    request = {
        "cursor": cursor,
        "requestedPageType": "STAYS_SEARCH",
        "metadataOnly": False,
        "source": "structured_search_input_header",
        "searchType": "user_map_move",
        "treatmentFlags": TREATMENT_FLAGS,
        "rawParams": raw_params,
    }
    return {
        "operationName": "StaysSearch",
        "extensions": {
            "persistedQuery": {"version": 1, "sha256Hash": operation_id}
        },
        "variables": {
            "skipExtendedSearchParams": False,
            "includeMapResults": True,
            "isLeanTreatment": False,
            "aiSearchEnabled": False,
            "staysMapSearchRequestV2": dict(request),
            "staysSearchRequest": {**request, "maxMapItems": max_map_items},
        },
    }


def get(
    api_key: str, cursor: str,
    check_in: str | date | datetime | None,
    check_out: str | date | datetime | None,
    ne_lat: float | None, ne_long: float | None,
    sw_lat: float | None, sw_long: float | None,
    zoom_value: int | None, currency: str, place_type: str,
    price_min: int | float, price_max: int | float,
    amenities: Iterable[int | str] | None, free_cancellation: bool,
    adults: int, children: int, infants: int,
    min_bedrooms: int, min_beds: int, min_bathrooms: int | float,
    language: str, proxy_url: str, hash: str,
    raw_params: list[dict[str, list[str]]] | None = None,
    timeout: Timeout = DEFAULT_TIMEOUT, *, query: str | None = None,
    place_id: str | None = None, room_types: Iterable[str] | None = None,
    pets: int = 0,
    property_type_ids: Iterable[int | str] | None = None,
    accessibility_features: Iterable[int | str] | None = None,
    instant_book: bool = False, superhost: bool = False,
    extra_filters: Mapping[str, Iterable[object] | object] | None = None,
    max_map_items: int = 9999,
):
    _validated_map_size(max_map_items)
    operation_id = hash or DEFAULT_OPERATION_ID
    query_params = urlencode(
        {"operationName": "StaysSearch", "locale": language,
         "currency": currency}
    )
    url = (
        f"https://www.airbnb.com/api/v3/StaysSearch/{operation_id}?"
        f"{query_params}"
    )
    values = _raw_params(raw_params, locals())
    headers = {**HEADERS, "X-Airbnb-Api-Key": api_key}
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    response = get_http_session(proxy_url).post(
        url,
        json=_search_request(operation_id, cursor, values, max_map_items),
        headers=headers,
        proxies=proxies,
        impersonate="chrome124",
        timeout=timeout,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"Unexpected status code {response.status_code}: {response.text}"
        )
    return response.json()
