from concurrent.futures import ThreadPoolExecutor
import threading
from unittest.mock import Mock

import pytest

from pyairbnb import api


class FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        return None


@pytest.fixture(autouse=True)
def empty_api_key_cache():
    api.clear_cache()
    yield
    api.clear_cache()


def test_api_key_is_cached_without_no_cache_headers(monkeypatch):
    request = Mock(return_value=FakeResponse('{"api_config": {"key": "key-1"}}'))
    monkeypatch.setattr(api.http_session, "get", request)

    assert api.get("") == "key-1"
    assert api.get("") == "key-1"

    assert request.call_count == 1
    headers = request.call_args.kwargs["headers"]
    assert "Cache-Control" not in headers
    assert "Pragma" not in headers
    assert "Connection" not in headers


def test_expired_api_key_is_refetched(monkeypatch):
    clock = [100.0]
    responses = iter(
        [
            FakeResponse('{"api_config":{"key":"first"}}'),
            FakeResponse('{"api_config":{"key":"second"}}'),
        ]
    )
    request = Mock(side_effect=lambda *args, **kwargs: next(responses))
    monkeypatch.setattr(api.http_session, "get", request)
    monkeypatch.setattr(api.time, "monotonic", lambda: clock[0])

    assert api.get("", cache_ttl=5) == "first"
    clock[0] += 6
    assert api.get("", cache_ttl=5) == "second"
    assert request.call_count == 2


def test_concurrent_callers_share_one_api_key_fetch(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    call_count = 0
    count_lock = threading.Lock()

    def fetch(*args, **kwargs):
        nonlocal call_count
        with count_lock:
            call_count += 1
        started.set()
        assert release.wait(timeout=2)
        return FakeResponse('{"api_config":{"key":"shared"}}')

    monkeypatch.setattr(api.http_session, "get", fetch)
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(api.get, "") for _ in range(8)]
        assert started.wait(timeout=2)
        release.set()
        assert [future.result(timeout=2) for future in futures] == [
            "shared"
        ] * 8

    assert call_count == 1


def test_force_refresh_replaces_cached_value(monkeypatch):
    responses = iter(
        [
            FakeResponse('{"api_config":{"key":"first"}}'),
            FakeResponse('{"api_config":{"key":"second"}}'),
        ]
    )
    monkeypatch.setattr(
        api.http_session,
        "get",
        Mock(side_effect=lambda *args, **kwargs: next(responses)),
    )

    assert api.get("") == "first"
    assert api.get("", force_refresh=True) == "second"
    assert api.get("") == "second"


def test_missing_api_key_has_actionable_error(monkeypatch):
    monkeypatch.setattr(
        api.http_session,
        "get",
        Mock(return_value=FakeResponse("<html>changed</html>")),
    )

    with pytest.raises(RuntimeError, match="extract Airbnb API key"):
        api.get("")


def test_concurrent_callers_share_one_failed_fetch(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    call_count = 0

    def fail(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        started.set()
        assert release.wait(timeout=2)
        raise OSError("origin unavailable")

    monkeypatch.setattr(api.http_session, "get", fail)
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(api.get, "") for _ in range(5)]
        assert started.wait(timeout=2)
        release.set()
        errors = []
        for future in futures:
            with pytest.raises((OSError, RuntimeError)) as captured:
                future.result(timeout=2)
            errors.append(captured.value)

    assert call_count == 1
    assert all("unavailable" in str(error.__cause__ or error) for error in errors)


def test_clear_during_fetch_prevents_result_from_repopulating_cache(monkeypatch):
    started = threading.Event()
    release = threading.Event()
    call_count = 0

    def fetch(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        request_number = call_count
        if request_number == 1:
            started.set()
            assert release.wait(timeout=2)
            return FakeResponse('{"api_config":{"key":"invalidated"}}')
        return FakeResponse('{"api_config":{"key":"fresh"}}')

    monkeypatch.setattr(api.http_session, "get", fetch)
    with ThreadPoolExecutor(max_workers=1) as executor:
        first = executor.submit(api.get, "")
        assert started.wait(timeout=2)
        api.clear_cache("")
        assert api.get("") == "fresh"
        release.set()
        assert first.result(timeout=2) == "invalidated"

    assert api.get("") == "fresh"
    assert call_count == 2


def test_http_sessions_are_isolated_per_proxy():
    proxy_a = api.get_http_session("http://proxy-a.example")
    proxy_b = api.get_http_session("http://proxy-b.example")

    assert proxy_a is api.get_http_session("http://proxy-a.example")
    assert proxy_a is not proxy_b
    assert proxy_a is not api.http_session


def test_retired_proxy_session_can_be_closed(monkeypatch):
    proxy_url = "http://retired-proxy.example"
    session = api.get_http_session(proxy_url)
    close = Mock()
    monkeypatch.setattr(session, "close", close)

    api.clear_http_sessions(proxy_url)

    close.assert_called_once_with()
    assert api.get_http_session(proxy_url) is not session
