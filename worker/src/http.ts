import {
  getAvailability,
  getListingQuote,
  resolveLocation,
  searchFlexibleStays,
  searchStays,
} from "./airbnb.js";
import { PUBLIC_HEADERS } from "./constants.js";
import { classifyPublicError, RequestError } from "./errors.js";
import {
  availabilityInputSchema,
  quoteInputSchema,
  resolveLocationInputSchema,
  searchFlexibleStaysInputSchema,
  searchStaysInputSchema,
} from "./schemas.js";

type RuntimeEnv = Env & { PYAIRBNB_API_TOKEN?: string };

export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [key, headerValue] of Object.entries(PUBLIC_HEADERS)) {
    headers.set(key, headerValue);
  }
  return Response.json(value, { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  const classified = classifyPublicError(error);
  return json(classified.body, { status: classified.status });
}

async function readJson(request: Request): Promise<unknown> {
  const maxBytes = 64 * 1024;
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes) {
    throw new RequestError("request_too_large", "Request bodies are limited to 64 KiB", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("invalid_json", "Request body must be valid JSON");
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel("request body limit exceeded");
      throw new RequestError("request_too_large", "Request bodies are limited to 64 KiB", 413);
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  try {
    return JSON.parse(chunks.join("")) as unknown;
  } catch {
    throw new RequestError("invalid_json", "Request body must be valid JSON");
  }
}

function unauthorized(request: Request, env: RuntimeEnv): boolean {
  if (!env.PYAIRBNB_API_TOKEN) return false;
  return request.headers.get("Authorization") !== `Bearer ${env.PYAIRBNB_API_TOKEN}`;
}

async function requestActorKey(request: Request): Promise<string> {
  const identity =
    request.headers.get("Authorization") ??
    request.headers.get("CF-Connecting-IP") ??
    "anonymous";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function isFlexibleCall(request: Request, pathname: string): Promise<boolean> {
  if (pathname === "/v1/stays/flexible") return true;
  if (pathname !== "/mcp" || request.method !== "POST") return false;
  try {
    const body = await request.clone().json<unknown>();
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const message = body as Record<string, unknown>;
    const params = message.params;
    return (
      message.method === "tools/call" &&
      params !== null &&
      typeof params === "object" &&
      !Array.isArray(params) &&
      (params as Record<string, unknown>).name === "search_flexible_stays"
    );
  } catch {
    return false;
  }
}

export async function protectRequest(
  request: Request,
  pathname: string,
  env: Env,
): Promise<Response | null> {
  if (unauthorized(request, env)) {
    return json(
      { error: "unauthorized", message: "A valid bearer token is required", schema_version: "1.0" },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }
  const actorKey = await requestActorKey(request);
  const general = await env.MCP_RATE_LIMITER.limit({ key: actorKey });
  const flexible = await isFlexibleCall(request, pathname);
  const fanout = flexible
    ? await env.FLEX_RATE_LIMITER.limit({ key: actorKey })
    : { success: true };
  if (general.success && fanout.success) return null;
  return json(
    { error: "rate_limited", message: "Request limit reached; retry in 60 seconds", schema_version: "1.0" },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

export async function handleRest(
  request: Request,
  pathname: string,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, { status: 405 });
  const body = await readJson(request);
  if (pathname === "/v1/locations/resolve") {
    return json(await resolveLocation(resolveLocationInputSchema.parse(body), ctx));
  }
  if (pathname === "/v1/stays/search") {
    return json(await searchStays(searchStaysInputSchema.parse(body), ctx));
  }
  if (pathname === "/v1/stays/flexible") {
    return json(await searchFlexibleStays(searchFlexibleStaysInputSchema.parse(body), ctx));
  }
  if (pathname === "/v1/listings/quote") {
    return json(await getListingQuote(quoteInputSchema.parse(body), ctx));
  }
  if (pathname === "/v1/listings/availability") {
    return json(await getAvailability(availabilityInputSchema.parse(body), ctx));
  }
  return json({ error: "not_found" }, { status: 404 });
}
