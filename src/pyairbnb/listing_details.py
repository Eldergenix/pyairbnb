"""Orchestration for listing metadata, reviews, calendar, quote, and host."""

from collections.abc import Callable
from datetime import date, datetime
from urllib.parse import urlparse

import pyairbnb.api as api
import pyairbnb.calendarinfo as calendar
import pyairbnb.details as details
import pyairbnb.host_details as host_details
import pyairbnb.price as price
import pyairbnb.reviews as reviews
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


def get_calendar(
    api_key: str = "",
    room_id: str = "",
    proxy_url: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT,
):
    """Return the current month's calendar for a room."""
    if not api_key:
        api_key = api.get(proxy_url, timeout=timeout)
    now = datetime.now()
    return calendar.get(
        api_key, room_id, now.month, now.year, proxy_url, timeout=timeout
    )


def get_reviews(
    room_url: str,
    language: str = "en",
    proxy_url: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT,
):
    """Return reviews for the listing identified by ``room_url``."""
    _, price_input, _ = details.get(
        room_url, language, proxy_url, timeout=timeout
    )
    return reviews.get(
        price_input["api_key"],
        price_input["product_id"],
        "USD",
        language,
        proxy_url,
        timeout=timeout,
    )


def quote_date(value: str | date | datetime, name: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        raise TypeError(f"{name} must be an ISO date string or date object")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{name} must use YYYY-MM-DD format") from exc


def _listing_target(
    room_url: str | None,
    room_id: int | None,
    domain: str,
) -> tuple[str, int | str]:
    if not room_url and room_id is None:
        raise ValueError("Either room_url or room_id must be provided.")
    if not room_url:
        room_url = f"https://{domain}/rooms/{room_id}"
    if room_id is None:
        room_id = urlparse(room_url).path.split("/")[-1]
    return room_url, room_id


def _add_quote(
    data: dict, price_input: dict, cookies: dict,
    room_id: int | str, check_in: str | date | datetime | None,
    check_out: str | date | datetime | None, adults: int,
    currency: str, language: str, proxy_url: str, timeout: Timeout,
) -> None:
    if (check_in is None) != (check_out is None):
        raise ValueError("check_in and check_out must be provided together")
    if check_in is None or check_out is None:
        return
    quote_check_in = quote_date(check_in, "check_in")
    quote_check_out = quote_date(check_out, "check_out")
    if quote_check_out <= quote_check_in:
        raise ValueError("check_out must be after check_in")
    data["price"] = price.get(
        room_id=str(room_id), check_in=quote_check_in,
        check_out=quote_check_out, adults=adults, currency=currency,
        language=language, impresion_id=price_input["impression_id"],
        api_key=price_input["api_key"], cookies=cookies,
        proxy_url=proxy_url, timeout=timeout,
    )


def get_details(
    room_url: str | None, room_id: int | None, domain: str,
    check_in: str | date | datetime | None,
    check_out: str | date | datetime | None, adults: int, currency: str,
    language: str, proxy_url: str, timeout: Timeout,
    calendar_getter: Callable,
):
    room_url, resolved_room_id = _listing_target(room_url, room_id, domain)
    data, price_input, cookies = details.get(
        room_url, language, proxy_url, timeout=timeout
    )
    api_key = price_input["api_key"]
    data["reviews"] = reviews.get(
        api_key, price_input["product_id"], currency, language,
        proxy_url, timeout=timeout,
    )
    data["calendar"] = calendar_getter(
        api_key, resolved_room_id, proxy_url, timeout=timeout
    )
    _add_quote(
        data, price_input, cookies, resolved_room_id, check_in, check_out,
        adults, currency, language, proxy_url, timeout,
    )
    data["host_details"] = host_details.get(
        api_key, cookies, data["host"]["id"], language,
        proxy_url, timeout=timeout,
    )
    return data
