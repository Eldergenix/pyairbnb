from datetime import date
from unittest.mock import Mock

import pytest

from pyairbnb import search


def by_name(params):
    return {param["filterName"]: param["filterValues"] for param in params}


def test_build_search_filters_supports_agent_facing_filter_set():
    params = search.build_search_filters(
        query="New York, NY",
        place_id="ChIJOwg_06VPwokRYv534QaPC8g",
        check_in=date(2026, 8, 10),
        check_out="2026-08-13",
        ne_lat=40.92,
        ne_long=-73.70,
        sw_lat=40.49,
        sw_long=-74.27,
        zoom_value=11,
        price_min=100,
        price_max=450,
        room_types=["Entire home/apt", "Private room"],
        amenities=[4, "7", 4],
        free_cancellation=True,
        adults=2,
        children=1,
        infants=1,
        pets=1,
        min_bedrooms=2,
        min_beds=3,
        min_bathrooms=1.5,
        property_type_ids=[1, 2],
        accessibility_features=[110, 111],
        instant_book=True,
        superhost=True,
    )
    filters = by_name(params)

    assert filters["query"] == ["New York, NY"]
    assert filters["placeId"] == ["ChIJOwg_06VPwokRYv534QaPC8g"]
    assert filters["checkin"] == ["2026-08-10"]
    assert filters["checkout"] == ["2026-08-13"]
    assert filters["priceFilterNumNights"] == ["3"]
    assert filters["searchByMap"] == ["true"]
    assert filters["room_types"] == ["Entire home/apt", "Private room"]
    assert filters["amenities"] == ["4", "7"]
    assert filters["pets"] == ["1"]
    assert filters["min_bathrooms"] == ["1.5"]
    assert filters["l2_property_type_ids"] == ["1", "2"]
    assert filters["accessibility_features"] == ["110", "111"]
    assert filters["ib"] == ["true"]
    assert filters["superhost"] == ["true"]

    serialized = repr(params)
    assert "Galapagos" not in serialized
    assert "2024-02-01" not in serialized
    assert "monthlyStartDate" not in serialized
    assert filters["cdnCacheSafe"] == ["true"]
    assert "'cdnCacheSafe', 'filterValues': ['false']" not in serialized


def test_query_only_search_does_not_require_map_coordinates():
    filters = by_name(search.build_search_filters(query="Lisbon"))

    assert filters["query"] == ["Lisbon"]
    assert filters["searchByMap"] == ["false"]
    assert "neLat" not in filters


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"check_in": "2026-01-01"}, "provided together"),
        (
            {"check_in": "2026-01-02", "check_out": "2026-01-01"},
            "after check_in",
        ),
        ({"check_in": "01/01/2026", "check_out": "2026-01-02"}, "YYYY-MM-DD"),
        ({"ne_lat": 10}, "provided together"),
        (
            {"ne_lat": 10, "ne_long": 10, "sw_lat": 20, "sw_long": 5},
            "ne_lat",
        ),
        ({"price_min": 200, "price_max": 100}, "price_min"),
        ({"adults": -1}, "adults"),
        ({"room_types": ["Spaceship"]}, "unsupported room type"),
        ({"extra_filters": {"bad-name": "x"}}, "invalid extra filter"),
        (
            {"extra_filters": {"search_by_map": "true"}},
            "duplicates generated filter",
        ),
    ],
)
def test_filter_validation_rejects_ambiguous_requests(kwargs, message):
    with pytest.raises((TypeError, ValueError), match=message):
        search.build_search_filters(**kwargs)


def test_url_filters_are_forwarded_and_dates_are_validated():
    params = search.url_to_raw_params(
        "https://www.airbnb.com/s/homes?"
        "checkin=2026-09-01&checkout=2026-09-04&"
        "ne_lat=10&ne_lng=11&sw_lat=9&sw_lng=8&"
        "l2_property_type_ids%5B%5D=2&future_filter=kept"
    )
    filters = by_name(params)

    assert filters["priceFilterNumNights"] == ["3"]
    assert filters["l2_property_type_ids"] == ["2"]
    assert filters["futureFilter"] == ["kept"]
    assert filters["searchByMap"] == ["true"]
    assert "monthlyStartDate" not in filters


class JsonResponse:
    status_code = 200
    text = ""

    def json(self):
        return {"ok": True}


def test_get_posts_validated_filters_without_connection_close(monkeypatch):
    post = Mock(return_value=JsonResponse())
    monkeypatch.setattr(search.get_http_session(""), "post", post)

    result = search.get(
        "api-key",
        "",
        "2026-08-10",
        "2026-08-12",
        None,
        None,
        None,
        None,
        None,
        "USD",
        "",
        0,
        0,
        None,
        False,
        2,
        0,
        0,
        0,
        0,
        0,
        "en",
        "",
        "hash",
        query="Boston",
        pets=1,
        max_map_items=20,
    )

    assert result == {"ok": True}
    request = post.call_args.kwargs
    filters = by_name(
        request["json"]["variables"]["staysSearchRequest"]["rawParams"]
    )
    assert filters["query"] == ["Boston"]
    assert filters["pets"] == ["1"]
    assert request["json"]["variables"]["staysSearchRequest"][
        "maxMapItems"
    ] == 20
    assert request["headers"]["X-Airbnb-Api-Key"] == "api-key"
    assert "Connection" not in request["headers"]
    assert "Cache-Control" not in request["headers"]
