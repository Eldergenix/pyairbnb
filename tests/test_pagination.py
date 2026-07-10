import inspect
from unittest.mock import Mock

import pytest

from pyairbnb import start


def page(items, cursor):
    return {
        "items": items,
        "data": {
            "presentation": {
                "staysSearch": {
                    "results": {
                        "paginationInfo": {"nextPageCursor": cursor}
                    }
                }
            }
        },
    }


@pytest.fixture(autouse=True)
def simple_standardizer(monkeypatch):
    monkeypatch.setattr(
        start.standardize,
        "from_search",
        lambda response: response["items"],
    )


def test_search_all_stops_at_limit_and_reuses_filters(monkeypatch):
    responses = iter([page([1, 2], "next"), page([3, 4], "third")])
    get_page = Mock(side_effect=lambda *args, **kwargs: next(responses))
    monkeypatch.setattr(start.search, "get", get_page)

    results = start.search_all(
        query="Chicago",
        api_key="cached-key",
        limit=3,
        max_pages=5,
    )

    assert results == [1, 2, 3]
    assert get_page.call_count == 2
    first_filters = get_page.call_args_list[0].kwargs["raw_params"]
    second_filters = get_page.call_args_list[1].kwargs["raw_params"]
    assert first_filters is second_filters
    assert {p["filterName"]: p["filterValues"] for p in first_filters}[
        "query"
    ] == ["Chicago"]
    assert {p["filterName"]: p["filterValues"] for p in first_filters}[
        "itemsPerGrid"
    ] == ["3"]
    assert get_page.call_args.kwargs["max_map_items"] == 3


def test_search_all_stops_on_repeated_cursor(monkeypatch):
    responses = iter([page([1], "repeat"), page([2], "repeat")])
    get_page = Mock(side_effect=lambda *args, **kwargs: next(responses))
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all(
        query="Rome", api_key="key", max_pages=10
    ) == [1, 2]
    assert get_page.call_count == 2


def test_search_all_stops_at_max_pages(monkeypatch):
    get_page = Mock(
        side_effect=[page([1], "two"), page([2], "three")]
    )
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all(
        query="Paris", api_key="key", max_pages=2
    ) == [1, 2]
    assert get_page.call_count == 2


def test_default_pagination_preserves_more_than_ten_pages(monkeypatch):
    call_count = 0

    def get_page(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        next_cursor = str(call_count) if call_count < 11 else None
        return page([call_count], next_cursor)

    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all(query="Vienna", api_key="key") == list(
        range(1, 12)
    )
    assert call_count == 11


def test_deadline_stops_before_another_page_and_caps_timeout(monkeypatch):
    clock = iter([0.0, 0.0, 0.0, 2.0])
    monkeypatch.setattr(start.time, "monotonic", lambda: next(clock))
    get_page = Mock(return_value=page([1], "next"))
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all(
        query="Miami",
        api_key="key",
        max_pages=5,
        deadline=1,
        timeout=30,
    ) == [1]
    assert get_page.call_count == 1
    assert 0 < get_page.call_args.kwargs["timeout"] <= 1


def test_deadline_caps_total_tuple_timeout(monkeypatch):
    clock = iter([0.0, 0.0, 0.0, 2.0])
    monkeypatch.setattr(start.time, "monotonic", lambda: next(clock))
    get_page = Mock(return_value=page([1], "next"))
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all(
        query="Oslo",
        api_key="key",
        max_pages=5,
        deadline=1,
        timeout=(60, 60),
    ) == [1]
    assert get_page.call_args.kwargs["timeout"] == 1


def test_zero_limit_does_not_fetch_api_key_or_page(monkeypatch):
    get_key = Mock()
    get_page = Mock()
    monkeypatch.setattr(start.api, "get", get_key)
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all(query="Tokyo", limit=0) == []
    get_key.assert_not_called()
    get_page.assert_not_called()


def test_first_page_never_follows_cursor(monkeypatch):
    get_page = Mock(return_value=page([1, 2], "next"))
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_first_page(
        query="Berlin", api_key="key", limit=1
    ) == [1]
    assert get_page.call_count == 1


def test_url_page_size_is_capped_without_overriding_smaller_value(monkeypatch):
    get_page = Mock(return_value=page([1], None))
    monkeypatch.setattr(start.search, "get", get_page)

    assert start.search_all_from_url(
        "https://www.airbnb.com/s/homes?items_per_grid=5&query=Prague",
        api_key="key",
        limit=20,
    ) == [1]
    filters = {
        item["filterName"]: item["filterValues"]
        for item in get_page.call_args.kwargs["raw_params"]
    }
    assert filters["itemsPerGrid"] == ["5"]
    assert get_page.call_args.kwargs["max_map_items"] == 5


def test_legacy_positional_search_signature_still_works(monkeypatch):
    get_page = Mock(return_value=page([1], None))
    monkeypatch.setattr(start.search, "get", get_page)

    results = start.search_all(
        "2026-10-01",
        "2026-10-03",
        41.0,
        -72.0,
        40.0,
        -73.0,
        10,
        100,
        500,
        "Private room",
        [4],
        True,
        2,
        1,
        0,
        1,
        1,
        1,
        "USD",
        "en",
        "",
        "hash",
        20,
        api_key="key",
    )

    assert results == [1]


def test_search_defaults_are_not_mutable():
    assert inspect.signature(start.search_all).parameters[
        "amenities"
    ].default is None
    assert inspect.signature(start.search_first_page).parameters[
        "amenities"
    ].default is None


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"limit": -1}, "limit"),
        ({"max_pages": 0}, "max_pages"),
        ({"deadline": 0}, "deadline"),
    ],
)
def test_invalid_pagination_bounds_are_rejected(monkeypatch, kwargs, message):
    monkeypatch.setattr(start.search, "get", Mock())

    with pytest.raises((TypeError, ValueError), match=message):
        start.search_all(query="Madrid", api_key="key", **kwargs)
