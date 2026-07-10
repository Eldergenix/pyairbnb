"""Discovery of Airbnb's current persisted ``StaysSearch`` operation ID."""

import re

from pyairbnb.api import get_http_session
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


HEADERS = {
    "Accept": "application/json",
    "Accept-Language": "en",
    "Content-Type": "application/json",
    "Sec-Ch-Ua": (
        '"Not_A Brand";v="8", "Chromium";v="124", '
        '"Google Chrome";v="124"'
    ),
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 "
        "Safari/537.36"
    ),
}

_ASYNC_BUNDLE = re.compile(
    r"https://a0\.muscache\.com/airbnb/static/packages/web/[^/]+/"
    r"frontend/airmetro/browser/asyncRequire\.[^\"']+\.js"
)
_JS_PATH = re.compile(
    r"(?:common|[a-z]{2}(?:-[A-Za-z]{2,4})?)/[^\"'\\\s<>]+?\.js"
)
_STAYS_MODULE = re.compile(
    r"(?:common|[a-z]{2}(?:-[A-Za-z]{2,4})?)/frontend/stays-search/"
    r"routes/StaysSearchRoute/StaysSearchRoute\.prepare\.[^\"']+\.js"
)
_OPERATION_PATTERNS = (
    re.compile(
        r"['\"]?(?:name|operationName)['\"]?\s*:\s*['\"]StaysSearch['\"]"
        r"[\s\S]{0,2000}?['\"]?(?:operationId|sha256Hash)['\"]?\s*:\s*"
        r"['\"]([0-9a-f]{64})['\"]"
    ),
    re.compile(
        r"['\"]?(?:operationId|sha256Hash)['\"]?\s*:\s*"
        r"['\"]([0-9a-f]{64})['\"][\s\S]{0,2000}?"
        r"['\"]?(?:name|operationName)['\"]?\s*:\s*['\"]StaysSearch['\"]"
    ),
    re.compile(r"/api/v3/StaysSearch/([0-9a-f]{64})"),
    re.compile(r"StaysSearch/([0-9a-f]{64})"),
)


def _fetch_text(session, url: str, proxies: dict | None, timeout: Timeout) -> str:
    response = session.get(
        url,
        headers={"User-Agent": HEADERS["User-Agent"]},
        proxies=proxies,
        impersonate="chrome124",
        timeout=timeout,
    )
    response.raise_for_status()
    return response.text


def _candidate_paths(bundle_text: str) -> tuple[str, list[str]]:
    js_paths = _JS_PATH.findall(bundle_text)
    module_match = _STAYS_MODULE.search(bundle_text)
    if not module_match:
        raise RuntimeError("Unable to locate StaysSearchRoute module")
    module_path = module_match.group(0)
    if module_path not in js_paths:
        return module_path, [module_path]
    module_index = js_paths.index(module_path)
    return module_path, js_paths[max(0, module_index - 3) : module_index + 36]


def _operation_id(module_text: str, is_primary: bool) -> str | None:
    for pattern in _OPERATION_PATTERNS:
        match = pattern.search(module_text)
        if match:
            return match.group(1)
    if is_primary:
        hashes = re.findall(
            r"['\"]?(?:operationId|sha256Hash)['\"]?\s*:\s*"
            r"['\"]([0-9a-f]{64})['\"]",
            module_text,
        )
        if len(hashes) == 1:
            return hashes[0]
    return None


def fetch_stays_search_hash(
    proxy_url: str = "",
    timeout: Timeout = DEFAULT_TIMEOUT,
) -> str:
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None
    session = get_http_session(proxy_url)
    homepage = _fetch_text(session, "https://www.airbnb.com/", proxies, timeout)
    bundle_match = _ASYNC_BUNDLE.search(homepage)
    if not bundle_match:
        raise RuntimeError("Unable to locate StaysSearch bundle")
    bundle = _fetch_text(session, bundle_match.group(0), proxies, timeout)
    module_path, candidates = _candidate_paths(bundle)
    visited: set[str] = set()
    for path in candidates:
        if path in visited:
            continue
        visited.add(path)
        url = f"https://a0.muscache.com/airbnb/static/packages/web/{path}"
        operation_id = _operation_id(
            _fetch_text(session, url, proxies, timeout),
            path == module_path,
        )
        if operation_id:
            return operation_id
    raise RuntimeError("Unable to extract StaysSearch operationId")
