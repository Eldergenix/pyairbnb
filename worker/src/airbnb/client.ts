import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import { array, path, record, string } from "./payload.js";

export const AIRBNB_ORIGIN = "https://www.airbnb.com";
export const SEARCH_OPERATION_ID =
  "9f945886dcc032b9ef4ba770d9132eb0aa78053296b5405483944c229617b00b";
export const QUOTE_OPERATION_ID =
  "80c7889b4b0027d99ffea830f6c0d4911a6e863a957cbe1044823f0fc746bf1f";
export const AVAILABILITY_OPERATION_ID =
  "8f08e03c7bd16fcad3c92a3592c19a8b559a0d0855a84028d1163d4733ed9ade";
export const REVIEWS_OPERATION_ID =
  "dec1c8061483e78373602047450322fd474e79ba9afa8d3dbbc27f504030f91d";
export const HOST_LISTINGS_OPERATION_ID =
  "529ca816b8be0619618d48b31bf46c379543e297fd68c0a953922927e5497b43";

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ORIGIN_TIMEOUT_MS = 2_500;

function throwTransportError(error: unknown): never {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("timeout")
  ) {
    throw new UpstreamError("upstream_timeout", "Airbnb request timed out", 504);
  }
  throw new UpstreamError(
    "upstream_unavailable",
    "Airbnb could not be reached",
    502,
  );
}

export async function fetchAirbnb(
  url: URL | string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    });
  } catch (error) {
    throwTransportError(error);
  }
}

export async function readAirbnbText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throwTransportError(error);
  }
}

export async function fetchJson(
  url: URL | string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchAirbnb(url, init);
  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    throw new UpstreamError(
      authFailure ? "upstream_auth" : "upstream_rejected",
      `Airbnb rejected the request with HTTP ${response.status}`,
      response.status === 429 ? 503 : 502,
    );
  }
  try {
    return await response.json<unknown>();
  } catch (error) {
    throwTransportError(error);
  }
}

export function apiHeaders(apiKey: string): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "X-Airbnb-Api-Key": apiKey,
  };
}

export async function getApiKey(
  ctx: ExecutionContext,
  requireFresh = false,
): Promise<string> {
  const cached = await readThroughCache({
    namespace: "airbnb-api-key-v1",
    key: "public-web-key",
    freshTtlSeconds: 6 * 60 * 60,
    staleTtlSeconds: 24 * 60 * 60,
    requireFresh,
    ctx,
    load: loadApiKey,
  });
  return cached.value;
}

export async function withApiKeyRetry<T>(
  ctx: ExecutionContext,
  operation: (apiKey: string) => Promise<T>,
): Promise<T> {
  const apiKey = await getApiKey(ctx);
  try {
    return await operation(apiKey);
  } catch (error) {
    if (!(error instanceof UpstreamError) || error.code !== "upstream_auth") {
      throw error;
    }
    const refreshedApiKey = await getApiKey(ctx, true);
    return operation(refreshedApiKey);
  }
}

async function loadApiKey(): Promise<string> {
  const response = await fetchAirbnb(`${AIRBNB_ORIGIN}/`, {
    headers: { Accept: "text/html", "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new UpstreamError(
      "upstream_rejected",
      `Airbnb rejected API bootstrap with HTTP ${response.status}`,
      response.status === 429 ? 503 : 502,
    );
  }
  const html = await readAirbnbText(response);
  const match = html.match(/"api_config":\{"key":"([^"]+)"/);
  if (!match?.[1]) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb API bootstrap format changed",
    );
  }
  return match[1];
}

export async function getMarket(
  apiKey: string,
  language: string,
  currency: string,
  ctx: ExecutionContext,
): Promise<{ countryCode: string; satoriToken: string }> {
  const cached = await readThroughCache({
    namespace: "airbnb-market-v1",
    key: { language, currency },
    freshTtlSeconds: 6 * 60 * 60,
    staleTtlSeconds: 24 * 60 * 60,
    requireFresh: false,
    ctx,
    load: () => loadMarket(apiKey, language, currency),
  });
  return cached.value;
}

async function loadMarket(
  apiKey: string,
  language: string,
  currency: string,
): Promise<{ countryCode: string; satoriToken: string }> {
  const url = new URL("/api/v2/user_markets", AIRBNB_ORIGIN);
  url.searchParams.set("locale", language);
  url.searchParams.set("currency", currency);
  url.searchParams.set("language", language);
  const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
  const market = record(array(path(payload, ["user_markets"]))[0]);
  const countryCode = string(market?.country_code);
  const satoriToken = string(market?.satori_parameters);
  if (!countryCode || !satoriToken) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb did not return market configuration",
    );
  }
  return { countryCode, satoriToken };
}

export function encodeNodeId(prefix: string, listingId: string): string {
  return btoa(`${prefix}:${listingId}`);
}
