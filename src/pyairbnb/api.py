from dataclasses import dataclass, field
import math
import re
import threading
import time

from curl_cffi import requests

from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout

ep = "https://www.airbnb.com"

API_KEY_CACHE_TTL_SECONDS = 15 * 60
http_session = requests.Session(impersonate="chrome124")
_session_lock = threading.Lock()
_http_sessions = {"": http_session}

regx_api_key = re.compile(
    r'"api_config"\s*:\s*\{\s*"key"\s*:\s*"(?P<key>[^"\\]+)"'
)

_cache_lock = threading.Lock()
_api_key_cache: dict[str, tuple[str, float]] = {}
_cache_epoch = 0
_proxy_generations: dict[str, int] = {}


@dataclass
class _Flight:
    generation: tuple[int, int]
    event: threading.Event = field(default_factory=threading.Event)
    value: str | None = None
    error: BaseException | None = None


_api_key_inflight: dict[tuple[str, tuple[int, int]], _Flight] = {}


def get_http_session(proxy_url: str = ""):
    """Return a connection-reusing session isolated to one proxy identity."""

    cache_key = proxy_url or ""
    with _session_lock:
        session = _http_sessions.get(cache_key)
        if session is None:
            session = requests.Session(impersonate="chrome124")
            _http_sessions[cache_key] = session
        return session


def clear_http_sessions(proxy_url: str | None = None) -> None:
    """Close cached HTTP sessions when no requests are using them.

    Long-lived proxy rotators should call this for retired proxies (or with no
    argument during shutdown) so native curl handles and cookie jars are
    released deterministically.
    """

    global http_session

    with _session_lock:
        if proxy_url is None:
            sessions = list(_http_sessions.values())
            http_session = requests.Session(impersonate="chrome124")
            _http_sessions.clear()
            _http_sessions[""] = http_session
        else:
            cache_key = proxy_url or ""
            session = _http_sessions.pop(cache_key, None)
            sessions = [session] if session is not None else []
            if cache_key == "":
                http_session = requests.Session(impersonate="chrome124")
                _http_sessions[""] = http_session

    for session in sessions:
        session.close()


def clear_cache(proxy_url: str | None = None) -> None:
    """Clear cached Airbnb API keys.

    Passing a proxy URL only clears the key fetched through that proxy. With
    no argument, every cached key is removed. In-flight fetches are left alone
    so callers already waiting on them are still released safely.
    """

    global _cache_epoch

    with _cache_lock:
        if proxy_url is None:
            _api_key_cache.clear()
            _cache_epoch += 1
        else:
            _api_key_cache.pop(proxy_url, None)
            _proxy_generations[proxy_url] = (
                _proxy_generations.get(proxy_url, 0) + 1
            )


def _fetch_api_key(proxy_url: str, timeout: Timeout) -> str:
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en",
        "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="124", "Google Chrome";v="124"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    }
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    response = get_http_session(proxy_url).get(
        ep,
        headers=headers,
        proxies=proxies,
        timeout=timeout,
    )
    response.raise_for_status()

    match = regx_api_key.search(response.text)
    if match is None:
        raise RuntimeError("Unable to extract Airbnb API key from homepage")
    return match.group("key")


def _wait_timeout(timeout: Timeout) -> float | None:
    if timeout is None:
        return None
    if isinstance(timeout, tuple):
        return sum(float(value) for value in timeout)
    return float(timeout)


def get(
    proxy_url: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT,
    *,
    cache_ttl: float = API_KEY_CACHE_TTL_SECONDS,
    force_refresh: bool = False,
) -> str:
    """Return Airbnb's public web API key with a per-proxy TTL cache.

    Concurrent callers for the same proxy share one in-flight homepage fetch.
    ``force_refresh`` bypasses a completed cache entry but still joins an
    already-running refresh, avoiding a thundering herd.
    """

    if isinstance(cache_ttl, bool) or not isinstance(cache_ttl, (int, float)):
        raise TypeError("cache_ttl must be a number")
    if not math.isfinite(cache_ttl):
        raise ValueError("cache_ttl must be finite")
    if cache_ttl < 0:
        raise ValueError("cache_ttl must be greater than or equal to zero")

    cache_key = proxy_url or ""
    refresh = force_refresh

    while True:
        now = time.monotonic()
        with _cache_lock:
            cached = _api_key_cache.get(cache_key)
            if not refresh and cached is not None and cached[1] > now:
                return cached[0]

            generation = (
                _cache_epoch,
                _proxy_generations.get(cache_key, 0),
            )
            flight_key = (cache_key, generation)
            flight = _api_key_inflight.get(flight_key)
            if flight is None:
                flight = _Flight(generation=generation)
                _api_key_inflight[flight_key] = flight
                break

        # A concurrent refresh satisfies this caller, including callers that
        # requested force_refresh while that refresh was already in progress.
        if not flight.event.wait(timeout=_wait_timeout(timeout)):
            raise TimeoutError("Timed out waiting for Airbnb API key refresh")
        if flight.error is not None:
            raise RuntimeError("Airbnb API key refresh failed") from flight.error
        if flight.value is not None:
            return flight.value
        refresh = False

    try:
        api_key = _fetch_api_key(proxy_url, timeout)
    except BaseException as exc:
        with _cache_lock:
            flight.error = exc
            _api_key_inflight.pop(flight_key, None)
            flight.event.set()
        raise

    with _cache_lock:
        current_generation = (
            _cache_epoch,
            _proxy_generations.get(cache_key, 0),
        )
        if flight.generation == current_generation:
            if cache_ttl > 0:
                _api_key_cache[cache_key] = (
                    api_key,
                    time.monotonic() + cache_ttl,
                )
            else:
                _api_key_cache.pop(cache_key, None)
        flight.value = api_key
        _api_key_inflight.pop(flight_key, None)
        flight.event.set()

    return api_key
