import { UpstreamError } from "./errors.js";

export type CacheStatus = "hit" | "miss" | "stale" | "bypass";

interface NegativeMarker {
  code: string;
  message: string;
  status: number;
}

interface CacheEnvelope<T> {
  value: T;
  fetchedAt: string;
  freshUntil: number;
  staleUntil: number;
  error?: NegativeMarker | null;
}

export interface CachedValue<T> {
  value: T;
  status: CacheStatus;
  fetchedAt: string;
  ageSeconds: number;
  stale: boolean;
}

interface ReadThroughOptions<T> {
  namespace: string;
  key: unknown;
  freshTtlSeconds: number;
  staleTtlSeconds: number;
  requireFresh: boolean;
  ctx: ExecutionContext;
  load: () => Promise<T>;
  /**
   * When set, a transient UpstreamError from `load()` is cached for this many
   * seconds so repeated identical calls fail fast instead of each paying the
   * full origin timeout. Only UpstreamErrors are cached; client/validation
   * errors always propagate.
   */
  negativeTtlSeconds?: number;
}

const inFlightLoads = new Map<string, Promise<unknown>>();

export async function coalescedLoad<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = inFlightLoads.get(key);
  if (existing) {
    // A canonical cache key always maps to one loader/result type.
    return (await existing) as T;
  }
  const pending = load();
  inFlightLoads.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightLoads.get(key) === pending) inFlightLoads.delete(key);
  }
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForJson(child)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortForJson(value));
}

export async function canonicalCacheRequest(
  namespace: string,
  key: unknown,
): Promise<Request> {
  const bytes = new TextEncoder().encode(stableJson(key));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return new Request(`https://cache.pyairbnb.internal/${namespace}/${hash}`);
}

function isCacheEnvelope(value: unknown): value is CacheEnvelope<unknown> {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    "value" in candidate &&
    typeof candidate.fetchedAt === "string" &&
    typeof candidate.freshUntil === "number" &&
    typeof candidate.staleUntil === "number"
  );
}

async function readEnvelope<T>(
  cache: Cache,
  request: Request,
): Promise<CacheEnvelope<T> | null> {
  const response = await cache.match(request);
  if (!response) return null;
  const payload: unknown = await response.json();
  return isCacheEnvelope(payload) ? (payload as CacheEnvelope<T>) : null;
}

async function writeEnvelope<T>(
  cache: Cache,
  request: Request,
  envelope: CacheEnvelope<T>,
  staleTtlSeconds: number,
): Promise<void> {
  await cache.put(
    request,
    Response.json(envelope, {
      headers: {
        "Cache-Control": `public, max-age=${staleTtlSeconds}`,
        "Content-Type": "application/json; charset=utf-8",
      },
    }),
  );
}

// Bindings are deployment-stable, so capturing them once at request entry is
// safe across the concurrent requests an isolate serves.
let l2Cache: KVNamespace | null = null;
let metrics: AnalyticsEngineDataset | null = null;

export function configureCacheBindings(
  kv: KVNamespace | undefined,
  ae: AnalyticsEngineDataset | undefined,
): void {
  l2Cache = kv ?? null;
  metrics = ae ?? null;
}

function kvKey(request: Request): string {
  return new URL(request.url).pathname.slice(1);
}

function recordCacheMetric(
  namespace: string,
  status: CacheStatus,
  ageSeconds: number,
): void {
  if (!metrics) return;
  try {
    metrics.writeDataPoint({
      indexes: [namespace],
      blobs: [namespace, status],
      doubles: [status === "hit" ? 1 : 0, ageSeconds],
    });
  } catch {
    // Metrics are best-effort and must never affect a response.
  }
}

/**
 * Read the freshest available envelope: the per-colo Cache API first, then the
 * global KV L2. A KV hit backfills the colo cache so later same-colo reads stay
 * local.
 */
async function readAnyEnvelope<T>(
  cache: Cache,
  request: Request,
  ctx: ExecutionContext,
): Promise<CacheEnvelope<T> | null> {
  const local = await readEnvelope<T>(cache, request);
  if (local || !l2Cache) return local;
  const remote = await l2Cache
    .get(kvKey(request), "json")
    .catch(() => null);
  if (!isCacheEnvelope(remote)) return null;
  const envelope = remote as CacheEnvelope<T>;
  const ttl = Math.ceil((envelope.staleUntil - Date.now()) / 1000);
  if (ttl > 0) {
    ctx.waitUntil(
      writeEnvelope(cache, request, envelope, ttl).catch(() => undefined),
    );
  }
  return envelope;
}

/**
 * Persist a fresh envelope to both cache tiers. KV enforces a 60s minimum TTL,
 * so short-lived entries are colo-only.
 */
function persistEnvelope<T>(
  cache: Cache,
  request: Request,
  envelope: CacheEnvelope<T>,
  staleTtlSeconds: number,
  ctx: ExecutionContext,
): Promise<void> {
  if (l2Cache && staleTtlSeconds >= 60) {
    ctx.waitUntil(
      l2Cache
        .put(kvKey(request), JSON.stringify(envelope), {
          expirationTtl: staleTtlSeconds,
        })
        .catch(() => undefined),
    );
  }
  return writeEnvelope(cache, request, envelope, staleTtlSeconds);
}

function toCachedValue<T>(
  envelope: CacheEnvelope<T>,
  status: CacheStatus,
  now: number,
): CachedValue<T> {
  const fetchedAtMs = Date.parse(envelope.fetchedAt);
  return {
    value: envelope.value,
    status,
    fetchedAt: envelope.fetchedAt,
    ageSeconds: Number.isFinite(fetchedAtMs)
      ? Math.max(0, (now - fetchedAtMs) / 1000)
      : 0,
    stale: status === "stale",
  };
}

async function writeNegative(
  cache: Cache,
  request: Request,
  marker: NegativeMarker,
  negativeTtlSeconds: number,
): Promise<void> {
  const now = Date.now();
  const envelope: CacheEnvelope<null> = {
    value: null,
    fetchedAt: new Date(now).toISOString(),
    freshUntil: now + negativeTtlSeconds * 1000,
    staleUntil: now + negativeTtlSeconds * 1000,
    error: marker,
  };
  await writeEnvelope(cache, request, envelope, negativeTtlSeconds);
}

export async function readThroughCache<T>(
  options: ReadThroughOptions<T>,
): Promise<CachedValue<T>> {
  const result = await readThroughCacheInner(options);
  recordCacheMetric(options.namespace, result.status, result.ageSeconds);
  return result;
}

async function readThroughCacheInner<T>(
  options: ReadThroughOptions<T>,
): Promise<CachedValue<T>> {
  const cache = caches.default;
  const request = await canonicalCacheRequest(options.namespace, options.key);
  const now = Date.now();
  const stored = await readAnyEnvelope<T>(cache, request, options.ctx);

  // A cached transient failure fails fast until its short window elapses.
  if (stored?.error && !options.requireFresh && now < stored.freshUntil) {
    throw new UpstreamError(
      stored.error.code,
      stored.error.message,
      stored.error.status,
    );
  }
  const cached = stored && !stored.error ? stored : null;

  if (!options.requireFresh && cached && now < cached.freshUntil) {
    return toCachedValue(cached, "hit", now);
  }

  if (!options.requireFresh && cached && now <= cached.staleUntil) {
    const refresh = coalescedLoad(request.url, async () => {
      const value = await options.load();
      const refreshedAt = Date.now();
      const envelope: CacheEnvelope<T> = {
        value,
        fetchedAt: new Date(refreshedAt).toISOString(),
        freshUntil: refreshedAt + options.freshTtlSeconds * 1000,
        staleUntil: refreshedAt + options.staleTtlSeconds * 1000,
      };
      await persistEnvelope(
        cache,
        request,
        envelope,
        options.staleTtlSeconds,
        options.ctx,
      );
      return envelope;
    }).catch((error: unknown) => {
      console.error(
        JSON.stringify({
          message: "background cache refresh failed",
          namespace: options.namespace,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    options.ctx.waitUntil(refresh);
    return toCachedValue(cached, "stale", now);
  }

  try {
    const envelope = await coalescedLoad(request.url, async () => {
      const value = await options.load();
      const loadedAt = Date.now();
      const loadedEnvelope: CacheEnvelope<T> = {
        value,
        fetchedAt: new Date(loadedAt).toISOString(),
        freshUntil: loadedAt + options.freshTtlSeconds * 1000,
        staleUntil: loadedAt + options.staleTtlSeconds * 1000,
      };
      await persistEnvelope(
        cache,
        request,
        loadedEnvelope,
        options.staleTtlSeconds,
        options.ctx,
      );
      return loadedEnvelope;
    });
    const loadedAt = Date.parse(envelope.fetchedAt);
    return toCachedValue(
      envelope,
      options.requireFresh ? "bypass" : "miss",
      Number.isFinite(loadedAt) ? loadedAt : Date.now(),
    );
  } catch (error) {
    if (cached && now <= cached.staleUntil) {
      return toCachedValue(cached, "stale", now);
    }
    if (options.negativeTtlSeconds && error instanceof UpstreamError) {
      options.ctx.waitUntil(
        writeNegative(
          cache,
          request,
          {
            code: error.code,
            message: error.message,
            status: error.status,
          },
          options.negativeTtlSeconds,
        ).catch(() => undefined),
      );
    }
    throw error;
  }
}
