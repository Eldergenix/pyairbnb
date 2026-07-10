# ruff: noqa: F401
"""Compatibility facade for Airbnb stay search APIs.

The implementation is split by responsibility so transport, operation
discovery, location lookup, and filter construction can evolve independently.
Existing imports from :mod:`pyairbnb.search` remain supported.
"""

from collections.abc import Iterable, Mapping
from datetime import date, datetime
import math
import re
from urllib.parse import parse_qs, urlencode, urlparse

import pyairbnb.utils as utils
from pyairbnb.api import get_http_session
from pyairbnb.search_filter_values import (
    FILTER_NAME as _FILTER_NAME,
    ROOM_TYPES as _ROOM_TYPES,
    SNAKE_FILTERS as _SNAKE_FILTERS,
    enabled as _enabled,
    filter_name as _filter_name,
    iso_date as _iso_date,
    non_negative_int as _non_negative_int,
    non_negative_number as _non_negative_number,
    number_string as _number_string,
    string_values as _string_values,
    validated_dates as _validated_dates,
)
from pyairbnb.search_filters import (
    UI_DEFAULTS as _UI_DEFAULTS,
    add_filter as _add_filter,
    build_search_filters,
    url_to_raw_params,
)
from pyairbnb.search_location import (
    AUTOCOMPLETE_ENDPOINT as ep_autocomplete,
    MARKET_ENDPOINT as ep_market,
    get_markets,
    get_places_ids,
)
from pyairbnb.search_operation import (
    HEADERS as headers_global,
    fetch_stays_search_hash,
)
from pyairbnb.search_transport import TREATMENT_FLAGS, get
from pyairbnb.utils import DEFAULT_TIMEOUT, Timeout
