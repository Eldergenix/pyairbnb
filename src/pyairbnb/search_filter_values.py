"""Validation and normalization for Airbnb stay-search filter values."""

from collections.abc import Iterable
from datetime import date, datetime
import math
import re


SNAKE_FILTERS = {
    "accessibility_features",
    "amenities",
    "flexible_cancellation",
    "l2_property_type_ids",
    "min_bathrooms",
    "min_bedrooms",
    "min_beds",
    "price_max",
    "price_min",
    "room_types",
    "selected_filter_order",
}
ROOM_TYPES = {
    "Entire home/apt",
    "Hotel room",
    "Private room",
    "Shared room",
}
FILTER_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def filter_name(url_key: str) -> str:
    if url_key == "zoom":
        url_key = "zoom_level"
    if url_key in SNAKE_FILTERS or "_" not in url_key:
        return url_key
    head, *tail = url_key.split("_")
    return head + "".join(word.capitalize() for word in tail)


def iso_date(value: str | date | datetime | None, name: str) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if not isinstance(value, str):
        raise TypeError(f"{name} must be an ISO date string or date object")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{name} must use YYYY-MM-DD format") from exc
    if parsed.isoformat() != value:
        raise ValueError(f"{name} must use YYYY-MM-DD format")
    return value


def validated_dates(
    check_in: str | date | datetime | None,
    check_out: str | date | datetime | None,
) -> tuple[str | None, str | None, int | None]:
    check_in_value = iso_date(check_in, "check_in")
    check_out_value = iso_date(check_out, "check_out")
    if (check_in_value is None) != (check_out_value is None):
        raise ValueError("check_in and check_out must be provided together")
    if check_in_value is None:
        return None, None, None
    nights = (
        date.fromisoformat(check_out_value) - date.fromisoformat(check_in_value)
    ).days
    if nights <= 0:
        raise ValueError("check_out must be after check_in")
    return check_in_value, check_out_value, nights


def string_values(
    values: Iterable[object] | object | None,
    name: str,
) -> list[str]:
    if values is None:
        return []
    if isinstance(values, (str, bytes)) or not isinstance(values, Iterable):
        values = [values]
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value is None or isinstance(value, bool):
            raise ValueError(f"{name} values must be non-empty IDs or names")
        string_value = str(value).strip()
        if not string_value:
            raise ValueError(f"{name} values must be non-empty IDs or names")
        if string_value not in seen:
            normalized.append(string_value)
            seen.add(string_value)
    return normalized


def non_negative_number(
    value: int | float | None,
    name: str,
) -> int | float:
    if value is None:
        return 0
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be a number")
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    if value < 0:
        raise ValueError(f"{name} must be greater than or equal to zero")
    return value


def non_negative_int(value: int | None, name: str) -> int:
    normalized = non_negative_number(value, name)
    if not isinstance(normalized, int):
        raise TypeError(f"{name} must be an integer")
    return normalized


def number_string(value: int | float) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def enabled(value: bool | None, name: str) -> bool:
    if value is None:
        return False
    if not isinstance(value, bool):
        raise TypeError(f"{name} must be a boolean")
    return value
