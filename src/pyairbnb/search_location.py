"""Airbnb market and autocomplete endpoints used for location discovery."""

from urllib.parse import urlencode

from pyairbnb import utils
from pyairbnb.api import get_http_session
from pyairbnb.search_operation import HEADERS
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout


AUTOCOMPLETE_ENDPOINT = (
    "https://www.airbnb.com/api/v2/autocompletes-personalized"
)
MARKET_ENDPOINT = "https://www.airbnb.com/api/v2/user_markets"


def _get_json(
    endpoint: str,
    query_params: dict,
    api_key: str,
    proxy_url: str,
    timeout: Timeout,
) -> dict:
    url = f"{endpoint}?{urlencode(query_params)}"
    headers = {**HEADERS, "X-Airbnb-Api-Key": api_key}
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else {}
    response = get_http_session(proxy_url).get(
        url,
        headers=headers,
        proxies=proxies,
        impersonate="chrome124",
        timeout=timeout,
    )
    if response.status_code != 200:
        raise Exception(
            "Not corret status code: ",
            response.status_code,
            " response body: ",
            response.text,
        )
    return response.json()


def get_markets(
    currency: str,
    locale: str,
    api_key: str,
    proxy_url: str,
    timeout: Timeout = DEFAULT_TIMEOUT,
):
    return _get_json(
        MARKET_ENDPOINT,
        {"locale": locale, "currency": currency, "language": "en"},
        api_key,
        proxy_url,
        timeout,
    )


def get_places_ids(
    country: str,
    location_name: str,
    currency: str,
    locale: str,
    config_token: str,
    api_key: str,
    proxy_url: str,
    timeout: Timeout = DEFAULT_TIMEOUT,
):
    query_params = {
        "currency": currency,
        "country": country,
        "key": api_key,
        "language": "en",
        "locale": locale,
        "num_results": 10,
        "user_input": location_name,
        "api_version": "1.2.0",
        "satori_config_token": config_token,
        "vertical_refinement": "experiences",
        "region": "-1",
        "options": (
            "should_filter_by_vertical_refinement%7Chide_nav_results%7C"
            "should_show_stays%7Csimple_search%7C"
            "flex_destinations_june_2021_launch_web_treatment"
        ),
    }
    data = _get_json(
        AUTOCOMPLETE_ENDPOINT,
        query_params,
        api_key,
        proxy_url,
        timeout,
    )
    return utils.get_nested_value(data, "autocomplete_terms", [])
