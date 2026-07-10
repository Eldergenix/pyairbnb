from datetime import date
from unittest.mock import Mock

import pytest

from pyairbnb import start


@pytest.fixture
def detail_dependencies(monkeypatch):
    monkeypatch.setattr(
        start.details,
        "get",
        Mock(
            return_value=(
                {"host": {"id": "host-1"}},
                {
                    "product_id": "product-1",
                    "api_key": "api-key",
                    "impression_id": "impression-1",
                },
                {},
            )
        ),
    )
    monkeypatch.setattr(start.reviews, "get", Mock(return_value=[]))
    monkeypatch.setattr(start, "get_calendar", Mock(return_value=[]))
    monkeypatch.setattr(start.host_details, "get", Mock(return_value={}))
    quote = Mock(return_value={"main": {"price": "$200"}})
    monkeypatch.setattr(start.price, "get", quote)
    return quote


def test_get_details_converts_iso_dates_for_price_client(detail_dependencies):
    start.get_details(
        room_id=123,
        check_in="2026-08-10",
        check_out="2026-08-12",
    )

    assert detail_dependencies.call_args.kwargs["check_in"] == date(2026, 8, 10)
    assert detail_dependencies.call_args.kwargs["check_out"] == date(2026, 8, 12)


def test_get_details_requires_both_quote_dates(detail_dependencies):
    with pytest.raises(ValueError, match="provided together"):
        start.get_details(room_id=123, check_in="2026-08-10")
