import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))


try:
    import curl_cffi  # noqa: F401
except ModuleNotFoundError:
    # Unit tests mock every HTTP boundary. This tiny import shim keeps the
    # suite offline when the optional native curl_cffi wheel is unavailable.
    curl_cffi = types.ModuleType("curl_cffi")
    fake_requests = types.SimpleNamespace(
        Session=lambda **kwargs: types.SimpleNamespace(
            get=None,
            post=None,
            close=lambda: None,
        )
    )
    curl_cffi.requests = fake_requests
    sys.modules["curl_cffi"] = curl_cffi


try:
    import bs4  # noqa: F401
except ModuleNotFoundError:
    bs4 = types.ModuleType("bs4")
    bs4.BeautifulSoup = object
    sys.modules["bs4"] = bs4
