"""Construction of validated Airbnb ``StaysSearch`` raw filters."""

from collections.abc import Iterable, Mapping
from datetime import date, datetime
import math
from urllib.parse import parse_qs, urlparse

from pyairbnb.search_filter_values import (
    FILTER_NAME,
    ROOM_TYPES,
    enabled,
    filter_name,
    non_negative_int,
    non_negative_number,
    number_string,
    string_values,
    validated_dates,
)


UI_DEFAULTS = {
    "cdnCacheSafe": "true",
    "channel": "EXPLORE",
    "datePickerType": "calendar",
    "itemsPerGrid": "50",
    "priceFilterInputType": "0",
    "refinementPaths": "/homes",
    "screenSize": "large",
    "tabId": "home_tab",
    "version": "1.8.3",
}


def add_filter(
    params: list[dict[str, list[str]]],
    name: str,
    values: Iterable[object] | object,
) -> None:
    normalized = string_values(values, name)
    if normalized:
        params.append({"filterName": name, "filterValues": normalized})


def _add_date_filters(
    params: list[dict[str, list[str]]],
    check_in: str | date | datetime | None,
    check_out: str | date | datetime | None,
) -> None:
    check_in_value, check_out_value, nights = validated_dates(
        check_in, check_out
    )
    if check_in_value is not None:
        add_filter(params, "checkin", check_in_value)
        add_filter(params, "checkout", check_out_value)
        add_filter(params, "priceFilterNumNights", nights)


def _add_map_filters(
    params: list[dict[str, list[str]]],
    ne_lat: float | None,
    ne_long: float | None,
    sw_lat: float | None,
    sw_long: float | None,
    zoom_value: int | None,
) -> None:
    coordinates = (ne_lat, ne_long, sw_lat, sw_long)
    supplied = [value is not None for value in coordinates]
    if any(supplied) and not all(supplied):
        raise ValueError(
            "ne_lat, ne_long, sw_lat, and sw_long must be provided together"
        )
    if not all(supplied):
        if zoom_value is not None:
            raise ValueError("zoom_value requires map coordinates")
        add_filter(params, "searchByMap", "false")
        return
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        for value in coordinates
    ):
        raise TypeError("map coordinates must be finite numbers")
    assert ne_lat is not None and sw_lat is not None
    assert ne_long is not None and sw_long is not None
    if not -90 <= ne_lat <= 90 or not -90 <= sw_lat <= 90:
        raise ValueError("latitude must be between -90 and 90")
    if not -180 <= ne_long <= 180 or not -180 <= sw_long <= 180:
        raise ValueError("longitude must be between -180 and 180")
    if ne_lat < sw_lat:
        raise ValueError("ne_lat must be greater than or equal to sw_lat")
    for name, value in (
        ("neLat", ne_lat), ("neLng", ne_long),
        ("swLat", sw_lat), ("swLng", sw_long),
    ):
        add_filter(params, name, value)
    add_filter(params, "searchByMap", "true")
    if zoom_value is not None:
        if isinstance(zoom_value, bool) or not isinstance(zoom_value, int):
            raise TypeError("zoom_value must be an integer")
        if not 0 <= zoom_value <= 22:
            raise ValueError("zoom_value must be between 0 and 22")
        add_filter(params, "zoomLevel", zoom_value)


def _add_location_filters(
    params: list[dict[str, list[str]]],
    query: str | None,
    place_id: str | None,
) -> None:
    for name, value, filter_key in (
        ("query", query, "query"),
        ("place_id", place_id, "placeId"),
    ):
        if value is None:
            continue
        if not isinstance(value, str):
            raise TypeError(f"{name} must be a string")
        value = value.strip()
        if not value:
            raise ValueError(f"{name} must not be empty")
        add_filter(params, filter_key, value)


def _add_price_and_rooms(
    params: list[dict[str, list[str]]],
    selected: list[str],
    price_min: int | float | None,
    price_max: int | float | None,
    place_type: str | None,
    room_types: Iterable[str] | None,
) -> None:
    minimum = non_negative_number(price_min, "price_min")
    maximum = non_negative_number(price_max, "price_max")
    if minimum and maximum and minimum > maximum:
        raise ValueError("price_min must be less than or equal to price_max")
    if minimum:
        add_filter(params, "price_min", number_string(minimum))
    if maximum:
        add_filter(params, "price_max", number_string(maximum))
    normalized_rooms = string_values(room_types, "room_types")
    if place_type and not isinstance(place_type, str):
        raise TypeError("place_type must be a string")
    if place_type:
        normalized_rooms.insert(0, place_type)
    normalized_rooms = list(dict.fromkeys(normalized_rooms))
    invalid = set(normalized_rooms) - ROOM_TYPES
    if invalid:
        raise ValueError(f"unsupported room type: {', '.join(sorted(invalid))}")
    if normalized_rooms:
        add_filter(params, "room_types", normalized_rooms)
        selected.extend(f"room_types:{value}" for value in normalized_rooms)


def _add_guests_and_minimums(
    params: list[dict[str, list[str]]],
    selected: list[str],
    guests: tuple[int | None, int | None, int | None, int | None],
    minimums: tuple[int | None, int | None, int | float | None],
) -> None:
    for name, value in zip(
        ("adults", "children", "infants", "pets"), guests, strict=True
    ):
        count = non_negative_int(value, name)
        if count:
            add_filter(params, name, count)
    for name, value in zip(
        ("min_bedrooms", "min_beds"), minimums[:2], strict=True
    ):
        count = non_negative_int(value, name)
        if count:
            add_filter(params, name, count)
            selected.append(f"{name}:{count}")
    bathrooms = non_negative_number(minimums[2], "min_bathrooms")
    if bathrooms:
        value = number_string(bathrooms)
        add_filter(params, "min_bathrooms", value)
        selected.append(f"min_bathrooms:{value}")


def _add_amenities_and_cancellation(
    params: list[dict[str, list[str]]],
    selected: list[str],
    amenities: Iterable[int | str] | None,
) -> None:
    normalized = string_values(amenities, "amenities")
    if normalized:
        add_filter(params, "amenities", normalized)
        selected.extend(f"amenities:{value}" for value in normalized)


def _add_property_and_flags(
    params: list[dict[str, list[str]]],
    selected: list[str],
    property_types: Iterable[int | str] | None,
    accessibility: Iterable[int | str] | None,
    instant_book: bool | None,
    superhost: bool | None,
) -> None:
    for name, values in (
        ("l2_property_type_ids", property_types),
        ("accessibility_features", accessibility),
    ):
        normalized = string_values(values, name)
        if normalized:
            add_filter(params, name, normalized)
            selected.extend(f"{name}:{value}" for value in normalized)
    for input_name, filter_key, value in (
        ("instant_book", "ib", instant_book),
        ("superhost", "superhost", superhost),
    ):
        if enabled(value, input_name):
            add_filter(params, filter_key, "true")
            selected.append(f"{filter_key}:true")


def _add_extra_filters(
    params: list[dict[str, list[str]]],
    selected: list[str],
    extra_filters: Mapping[str, Iterable[object] | object] | None,
) -> None:
    if extra_filters is not None and not isinstance(extra_filters, Mapping):
        raise TypeError("extra_filters must be a mapping")
    existing = {param["filterName"] for param in params}
    if selected:
        existing.add("selected_filter_order")
    for raw_name, values in (extra_filters or {}).items():
        if not isinstance(raw_name, str) or not FILTER_NAME.fullmatch(raw_name):
            raise ValueError(f"invalid extra filter name: {raw_name!r}")
        canonical = filter_name(raw_name)
        if canonical in existing:
            raise ValueError(f"extra filter duplicates generated filter: {canonical}")
        add_filter(params, canonical, values)
        existing.add(canonical)


def build_search_filters(
    *, check_in: str | date | datetime | None = None,
    check_out: str | date | datetime | None = None,
    ne_lat: float | None = None, ne_long: float | None = None,
    sw_lat: float | None = None, sw_long: float | None = None,
    zoom_value: int | None = None, query: str | None = None,
    place_id: str | None = None, place_type: str | None = None,
    room_types: Iterable[str] | None = None,
    price_min: int | float | None = None,
    price_max: int | float | None = None,
    amenities: Iterable[int | str] | None = None,
    free_cancellation: bool | None = False,
    adults: int | None = None, children: int | None = None,
    infants: int | None = None, pets: int | None = None,
    min_bedrooms: int | None = None, min_beds: int | None = None,
    min_bathrooms: int | float | None = None,
    property_type_ids: Iterable[int | str] | None = None,
    accessibility_features: Iterable[int | str] | None = None,
    instant_book: bool | None = False, superhost: bool | None = False,
    extra_filters: Mapping[str, Iterable[object] | object] | None = None,
) -> list[dict[str, list[str]]]:
    """Build validated raw filters ready for Airbnb's GraphQL request."""
    params = [
        {"filterName": name, "filterValues": [value]}
        for name, value in UI_DEFAULTS.items()
    ]
    selected: list[str] = []
    _add_date_filters(params, check_in, check_out)
    _add_map_filters(params, ne_lat, ne_long, sw_lat, sw_long, zoom_value)
    _add_location_filters(params, query, place_id)
    _add_price_and_rooms(
        params, selected, price_min, price_max, place_type, room_types
    )
    _add_amenities_and_cancellation(params, selected, amenities)
    if enabled(free_cancellation, "free_cancellation"):
        add_filter(params, "flexible_cancellation", "true")
        selected.append("flexible_cancellation:true")
    _add_guests_and_minimums(
        params, selected, (adults, children, infants, pets),
        (min_bedrooms, min_beds, min_bathrooms),
    )
    _add_property_and_flags(
        params, selected, property_type_ids, accessibility_features,
        instant_book, superhost,
    )
    _add_extra_filters(params, selected, extra_filters)
    if selected:
        add_filter(params, "selected_filter_order", selected)
    return params


def url_to_raw_params(url: str) -> list[dict[str, list[str]]]:
    query_params = parse_qs(urlparse(url).query)
    raw_params = [
        {
            "filterName": filter_name(key[:-2] if key.endswith("[]") else key),
            "filterValues": [str(value) for value in values],
        }
        for key, values in query_params.items()
    ]
    seen = {param["filterName"] for param in raw_params}
    checkin = query_params.get("checkin", [None])[0]
    checkout = query_params.get("checkout", [None])[0]
    days = validated_dates(checkin, checkout)[2] if checkin or checkout else None
    if days is not None and "priceFilterNumNights" not in seen:
        add_filter(raw_params, "priceFilterNumNights", days)
        seen.add("priceFilterNumNights")
    for name, value in UI_DEFAULTS.items():
        if name not in seen:
            add_filter(raw_params, name, value)
    if "searchByMap" not in seen:
        has_map = {"neLat", "neLng", "swLat", "swLng"}.issubset(seen)
        add_filter(raw_params, "searchByMap", "true" if has_map else "false")
    return raw_params
