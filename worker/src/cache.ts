export type CacheStatus = "hit" | "miss" | "stale" | "bypass";

interface CacheEnvelope<T> {
  value: T;
  fetchedAt: string;
  freshUntil: number;
  staleUntil: number;
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

export async function readThroughCache<T>(
  options: ReadThroughOptions<T>,
): Promise<CachedValue<T>> {
  const cache = caches.default;
  const request = await canonicalCacheRequest(options.namespace, options.key);
  const now = Date.now();
  const cached = await readEnvelope<T>(cache, request);

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
      await writeEnvelope(cache, request, envelope, options.staleTtlSeconds);
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
      await writeEnvelope(
        cache,
        request,
        loadedEnvelope,
        options.staleTtlSeconds,
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
    throw error;
  }
}
