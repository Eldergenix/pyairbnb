# pyairbnb

A fast Airbnb data layer with two compatible surfaces:

- A production-oriented Cloudflare Worker exposing standard MCP Streamable HTTP,
  compact structured tool results, a portable MCP Apps listing grid, and REST
  endpoints for React Server Components.
- The original Python package, upgraded with connection reuse, API-key caching,
  validated filter construction, and bounded/deadline-aware pagination options.

The remote MCP server is designed for OpenAI, ChatGPT/Codex, Anthropic Claude,
Claude Code, and any client implementing the MCP Streamable HTTP transport.
It uses the protocol's JSON response mode so clients do not wait on SSE stream
buffering for ordinary tool calls.

## Performance contract

The fast path is cache-first and returns stale data while refreshing when Airbnb
is slow. The service reports `cache`, `freshness`, `timing_ms`, `warnings`, and
`partial` rather than hiding uncertainty.

Identical in-flight misses and refreshes are coalesced inside each Worker
isolate. Cloudflare edge limits cap general traffic at 120 requests/minute and
flexible fan-out at 20 requests/minute per caller key and colo.

| Lane | Target |
|---|---|
| Edge-cache hit | Under 3 seconds; normally tens of milliseconds |
| Warm live first page | Best effort under 3 seconds |
| Forced live origin | Best effort, outside the hard latency target |
| Flexible date fan-out | Up to six representative date combinations, searched concurrently |
| All pages / deep enrichment | Cursor-driven; never blocks the first card grid |

An unconditional live-origin guarantee is not technically honest: Airbnb can
throttle, challenge, or change its private web API. Cached/indexed responses are
the enforceable sub-three-second lane.

## MCP tools

| Tool | Purpose |
|---|---|
| `resolve_location` | Resolve cities, neighborhoods, landmarks, regions, or countries to Airbnb place IDs and bounds |
| `search_stays` | Exact-date search with compact cards, filters, sorting, and cursor pagination |
| `search_flexible_stays` | Compare bounded weekday/weekend and trip-length combinations concurrently |
| `get_listing_quote` | Confirm exact-date availability, total/nightly price, and line items |
| `get_listing_availability` | Read a bounded one-to-six-month calendar |

`search_stays` supports human-readable location or map bounds; check-in/out;
adults, children, infants, and pets; nightly min/max price; room/property types;
amenities and accessibility features; free cancellation; instant book;
superhost; minimum bedrooms/beds/bathrooms; rating/review thresholds; currency,
language, sort, result limit, cursor, and explicit fresh-cache bypass.

Stay inventory is day-based. Time-of-day filtering belongs to experiences, not
overnight stays.

## Run locally

```bash
npm install
npm run cf:types
npm run dev
```

The health endpoint is `http://localhost:8788/health` and MCP is
`http://localhost:8788/mcp`.

```bash
curl -X POST http://localhost:8788/v1/stays/search \
  -H 'Content-Type: application/json' \
  -d '{
    "location": "Tampa, Florida",
    "check_in": "2026-07-17",
    "check_out": "2026-07-19",
    "adults": 2,
    "pets": 1,
    "price_max": 500,
    "room_types": ["Entire home/apt"],
    "sort": "price_low_to_high",
    "limit": 12
  }'
```

## Install in agents

Public deployment:

- Origin: `https://pyairbnb-mcp.nexisfoundation.workers.dev`
- MCP: `https://pyairbnb-mcp.nexisfoundation.workers.dev/mcp`
- Health: `https://pyairbnb-mcp.nexisfoundation.workers.dev/health`

Codex:

```bash
codex mcp add pyairbnb --url https://pyairbnb-mcp.nexisfoundation.workers.dev/mcp
```

Claude Code:

```bash
claude mcp add --transport http --scope user pyairbnb https://pyairbnb-mcp.nexisfoundation.workers.dev/mcp
```

Claude and Claude Desktop: open **Settings → Connectors → Add custom
connector**, name it `pyairbnb`, and enter
`https://pyairbnb-mcp.nexisfoundation.workers.dev/mcp`.

The checked-in `.mcp.json` provides the same project-scoped HTTP configuration
for hosts that auto-discover that file.

For an agent instruction layer, copy the included skill:

```bash
# agentskills.io-compatible installer
npx skills add Eldergenix/pyairbnb --skill pyairbnb --agent '*' --global --yes

# Codex / agentskills.io hosts
mkdir -p ~/.agents/skills
cp -R skills/pyairbnb ~/.agents/skills/

# Claude Code
mkdir -p ~/.claude/skills
cp -R skills/pyairbnb ~/.claude/skills/
```

### OpenAI Responses API

```ts
import OpenAI from "openai";

const client = new OpenAI();
const response = await client.responses.create({
  model: process.env.OPENAI_MODEL!,
  input: "Find pet-friendly entire homes in Tampa next weekend under $500/night.",
  tools: [{
    type: "mcp",
    server_label: "pyairbnb",
    server_url: "https://pyairbnb-mcp.nexisfoundation.workers.dev/mcp",
    allowed_tools: ["resolve_location", "search_stays", "get_listing_quote"],
    require_approval: "never",
  }],
});
```

Keep the returned `mcp_list_tools` item in conversation context so OpenAI does
not relist tools every turn.

### Anthropic Messages API

```python
import anthropic
import os

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model=os.environ["ANTHROPIC_MODEL"],
    max_tokens=1200,
    messages=[{"role": "user", "content": "Find Tampa stays next weekend."}],
    mcp_servers=[{
        "type": "url",
        "url": "https://pyairbnb-mcp.nexisfoundation.workers.dev/mcp",
        "name": "pyairbnb",
    }],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "pyairbnb"}],
    betas=["mcp-client-2025-11-20"],
)
```

## UI output

- MCP clients always receive canonical `structuredContent` plus a JSON text
  fallback, so OpenAI and Anthropic can use the same result.
- MCP Apps-capable hosts receive `ui://pyairbnb/stays-v1.html`, served as
  `text/html;profile=mcp-app`; the view completes the standard MCP Apps
  handshake, host-link bridge, and resize lifecycle.
- `integrations/rsc` contains an async React Server Component consuming the
  REST search endpoint.
- `integrations/openui` contains an OpenUI Lang component library plus a tested
  `Renderer` and `toolProvider` binding for MCP clients or the REST facade.

## Deploy to Cloudflare

Use a least-privilege Workers API token in your shell; never place credentials
in this repository.

```bash
export CLOUDFLARE_ACCOUNT_ID='<account-id>'
export CLOUDFLARE_API_TOKEN='<workers-api-token>'
npm run check
npm run deploy
```

`wrangler.jsonc` enables current compatibility behavior, structured Workers
logs/traces, and local edge rate limits. The server is intentionally stateless;
Cache API entries are keyed by canonicalized, hashed search parameters and use
fresh/stale TTLs. It is authless by default for direct OpenAI/Anthropic
compatibility. To require a bearer token, set the optional secret:

```bash
npx wrangler secret put PYAIRBNB_API_TOKEN
```

## Python package

```bash
pip install pyairbnb
```

All HTTP-facing functions accept a `timeout` argument. It defaults to 60
seconds, accepts the same values as `curl_cffi` (`int`, `float`, or a connect /
read tuple), and can be `None`. Search-all functions additionally accept
optional `limit`, `max_pages`, and `deadline_seconds` controls without changing
legacy unbounded behavior when those controls are omitted.

With current Airbnb behavior, exact dates are required to obtain a price quote.
Dates use `YYYY-MM-DD`.

## Responsible use

Airbnb's web API is private and can change without notice. Use conservative
rates, honor applicable terms, robots directives, privacy requirements, and
local law, and do not use this project to bypass access controls. The server
does not automate login, CAPTCHA solving, or booking actions.

## Design references

- [MCP tools and structured content](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [Cloudflare remote MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/guides/remote-mcp-server/)
- [OpenAI Apps SDK MCP server and UI resources](https://developers.openai.com/apps-sdk/build/mcp-server)
- [OpenAI MCP and Connectors](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [OpenUI Lang](https://www.openui.com/docs/openui-lang)

## Legacy

This project was first implemented at
[johnbalvin/pybnb](https://github.com/johnbalvin/pybnb), then moved to
[johnbalvin/pyairbnb](https://github.com/johnbalvin/pyairbnb) to match the PyPI
package name.
## Examples

### Example for Searching Listings

```python
import pyairbnb
import json

# Define search parameters
currency = "MXN"  # Currency for the search
check_in = "2025-10-01"  # Check-in date
check_out = "2025-10-04"  # Check-out date
ne_lat = -0.6747456399483214 # North-East latitude
ne_long = -90.30058677891441  # North-East longitude
sw_lat = -0.7596840340260731  # South-West latitude
sw_long = -90.36727562895442  # South-West longitude
zoom_value = 2  # Zoom level for the map
price_min = 1000
price_max = 0
place_type = "Private room" #or "Entire home/apt" or empty
amenities = [4, 7]  # Example: Filter for listings with WiFi and Pool or leave empty
free_cancellation = False  # Filter for listings with free/flexible cancellation
language = "th"
proxy_url = ""

# Search listings within specified coordinates and date range using keyword arguments
search_results = pyairbnb.search_all(
    check_in=check_in,
    check_out=check_out,
    ne_lat=ne_lat,
    ne_long=ne_long,
    sw_lat=sw_lat,
    sw_long=sw_long,
    zoom_value=zoom_value,
    price_min=price_min,
    price_max=price_max,
    place_type=place_type,
    amenities=amenities,
    free_cancellation=free_cancellation,
    currency=currency,
    language=language,
    proxy_url=proxy_url,
    timeout=30,
)

# Save the search results as a JSON file
with open('search_results.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(search_results))  # Convert results to JSON and write to file
```

### Example: Searching via a full Airbnb URL

```python
import pyairbnb
import json

# Define an Airbnb search URL using only the supported parameters (including free cancellation)
url = "https://www.airbnb.com/s/Luxembourg--Luxembourg/homes?checkin=2026-02-09&checkout=2026-02-16&ne_lat=49.76537&ne_lng=6.56057&sw_lat=49.31155&sw_lng=6.03263&zoom=10&price_min=154&price_max=700&room_types%5B%5D=Entire%20home%2Fapt&amenities%5B%5D=4&amenities%5B%5D=5&flexible_cancellation=true"

# Fetches the live StaysSearch hash first so
# the persisted query id matches airbnb website.
dynamic_hash = pyairbnb.fetch_stays_search_hash()
# Use the URL wrapper
results = pyairbnb.search_all_from_url(
    url,
    currency="EUR",
    language="es",
    proxy_url="",
    hash=dynamic_hash, # optional, fallbacks to predefined hash
)

# Save results and print count
with open('search_from_url.json', 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print(f"Found {len(results)} listings from URL search.")
```

### Retrieving Details for Listings

### Getting price
```python
import pyairbnb
from datetime import date

data = pyairbnb.get_price(
    room_id="1316896675409654026",
    check_in=date(2026, 2, 4),
    check_out=date(2026, 2, 7),
    timeout=30,
)
```


### Getting listings from user id
```Python
import pyairbnb
import json
host_id = 656454528
api_key = pyairbnb.get_api_key("")
listings = pyairbnb.get_listings_from_user(host_id,api_key,"")
with open('listings.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(listings))
```

### Getting details from user id
```Python
import pyairbnb
import json
host_id = "656454528"
language = "en"
api_key = pyairbnb.get_api_key("")
listings = pyairbnb.get_host_details(api_key, None, host_id, language, "")
with open('listings.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(listings))
```

### Getting experiences by just taking the first autocompletions that you would normally do manually on the website
```Python
import pyairbnb
import json
check_in = "2026-05-10"
check_out = "2026-05-12"
currency = "EUR"
user_input_text = "Estados Unidos"
locale = "es"
proxy_url = ""  # Proxy URL (if needed)
api_key = pyairbnb.get_api_key("")
experiences = pyairbnb.experience_search(user_input_text, currency, locale, check_in, check_out, api_key, proxy_url)
with open('experiences.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(experiences))
```

### Getting experiences by first getting the autocompletions
```Python
import pyairbnb
import json
check_in = "2026-05-06"
check_out = "2026-05-10"
currency = "USD"
user_input_text = "cuenca"
locale = "pt"
proxy_url = ""  # Proxy URL (if needed)
api_key = pyairbnb.get_api_key("")
markets_data = pyairbnb.get_markets(currency,locale,api_key,proxy_url)
markets = pyairbnb.get_nested_value(markets_data,"user_markets", [])
if len(markets)==0:
    raise Exception("markets are empty")
config_token = pyairbnb.get_nested_value(markets[0],"satori_parameters", "")
country_code = pyairbnb.get_nested_value(markets[0],"country_code", "")
if config_token=="" or country_code=="":
    raise Exception("config_token or country_code are empty")
place_ids_results = pyairbnb.get_places_ids(country_code, user_input_text, currency, locale, config_token, api_key, proxy_url)
if len(place_ids_results)==0:
    raise Exception("empty places ids")
place_id = pyairbnb.get_nested_value(place_ids_results[0],"location.google_place_id", "")
location_name = pyairbnb.get_nested_value(place_ids_results[0],"location.location_name", "")
if place_id=="" or location_name=="":
    raise Exception("place_id or location_name are empty")
[result,cursor] = pyairbnb.experience_search_by_place_id("", place_id, location_name, currency, locale, check_in, check_out, api_key, proxy_url)
while cursor!="":
    [result_tmp,cursor] = pyairbnb.experience_search_by_place_id(cursor, place_id, location_name, currency, locale, check_in, check_out, api_key, proxy_url)
    if len(result_tmp)==0:
        break
    result = result + result_tmp
with open('experiences.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(result))
```

### Getting available/unavailable homes along with metadata
```Python
import pyairbnb
import json

# Define listing URL and parameters
room_url = "https://www.airbnb.com/rooms/21734211"  # Listing URL
currency = "USD"  # Currency for the listing details
checkin = "2026-05-12"
checkout = "2026-05-17"
# Retrieve listing details without including the price information (no check-in/check-out dates)
data = pyairbnb.get_details(room_url=room_url, currency=currency,adults=2, language="ja")

# Save the retrieved details to a JSON file
with open('details_data.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(data))  # Convert the data to JSON and save it
```

#### Retrieve Details Using Room ID with Proxy
You can also use `get_details` with a room ID and an optional proxy.

```python
import pyairbnb
from urllib.parse import urlparse
import json

# Define listing parameters
room_id = 856200458932468228  # Listing room ID
currency = "MXN"  # Currency for the listing details
proxy_url = ""  # Proxy URL (if needed)

# Retrieve listing details by room ID with a proxy
checkin = "2026-05-12"
checkout = "2026-05-17"
data = pyairbnb.get_details(room_id=room_id, currency=currency, proxy_url=proxy_url,adults=3, language="ko")

# Save the retrieved details to a JSON file
with open('details_data.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(data))  # Convert the data to JSON and save it
```

### Retrieve Reviews for a Listing
Use `get_reviews` to extract reviews and metadata for a specific listing.

```python
import pyairbnb
import json

# Define listing URL and proxy URL
room_url = "https://www.airbnb.com/rooms/30931885"  # Listing URL
proxy_url = ""  # Proxy URL (if needed)
language = "fr"
# Retrieve reviews for the specified listing
reviews_data = pyairbnb.get_reviews(room_url, language, proxy_url)

# Save the reviews data to a JSON file
with open('reviews.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(reviews_data))  # Extract reviews and save them to a file
```

### Retrieve Availability for a Listing
The `get_calendar` function provides availability information for specified listings.

```python
import pyairbnb
import json

# Define listing parameters
room_id = "44590727"  # Listing room ID
proxy_url = ""  # Proxy URL (if needed)

# Retrieve availability for the specified listing
calendar_data = pyairbnb.get_calendar(room_id, "", proxy_url)

# Save the calendar data (availability) to a JSON file
with open('calendar.json', 'w', encoding='utf-8') as f:
    f.write(json.dumps(calendar_data))  # Extract calendar data and save it to a file
```
