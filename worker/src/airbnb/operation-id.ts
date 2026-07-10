import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import {
  AIRBNB_ORIGIN,
  USER_AGENT,
  fetchAirbnb,
  readAirbnbText,
} from "./client.js";
import { array, path } from "./payload.js";

const ASSET_BASE = "https://a0.muscache.com/airbnb/static/packages/web/";

export function extractStaysSearchOperationId(source: string): string | null {
  const patterns = [
    /(?:name|operationName)["']?\s*:\s*["']StaysSearch["'][\s\S]{0,2000}?(?:operationId|sha256Hash)["']?\s*:\s*["']([0-9a-f]{64})["']/,
    /(?:operationId|sha256Hash)["']?\s*:\s*["']([0-9a-f]{64})["'][\s\S]{0,2000}?(?:name|operationName)["']?\s*:\s*["']StaysSearch["']/,
    /\/api\/v3\/StaysSearch\/([0-9a-f]{64})/,
    /StaysSearch\/([0-9a-f]{64})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function hasPersistedQueryError(payload: unknown): boolean {
  const errors = array(path(payload, ["errors"]));
  if (errors.length === 0) return false;
  const serialized = JSON.stringify(errors).toLowerCase();
  return (
    serialized.includes("persistedquery") ||
    serialized.includes("persisted_query") ||
    serialized.includes("sha256hash")
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchAirbnb(url, {
    headers: { Accept: "text/html,*/*", "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new UpstreamError(
      "operation_discovery_failed",
      `Airbnb operation discovery returned HTTP ${response.status}`,
    );
  }
  return readAirbnbText(response);
}

function candidateModulePaths(bundle: string): string[] {
  const paths = [...bundle.matchAll(
    /(?:common|[a-z]{2}(?:-[A-Za-z]{2,4})?)\/[^"'\\\s<>]+?\.js/g,
  )].map((match) => match[0]);
  const modulePath = paths.find((value) =>
    value.includes("/frontend/stays-search/routes/StaysSearchRoute/StaysSearchRoute.prepare."),
  );
  if (!modulePath) return [];
  const index = paths.indexOf(modulePath);
  return [...new Set([
    modulePath,
    ...paths.slice(Math.max(0, index - 3), index + 36),
  ])];
}

async function discoverOperationId(): Promise<string> {
  const homepage = await fetchText(`${AIRBNB_ORIGIN}/`);
  const bundleUrl = homepage.match(
    /https:\/\/a0\.muscache\.com\/airbnb\/static\/packages\/web\/[^/]+\/frontend\/airmetro\/browser\/asyncRequire\.[^"']+\.js/,
  )?.[0];
  if (!bundleUrl) {
    throw new UpstreamError(
      "operation_discovery_failed",
      "Airbnb operation bundle was not found",
    );
  }
  const bundle = await fetchText(bundleUrl);
  const candidates = candidateModulePaths(bundle);
  for (let offset = 0; offset < candidates.length; offset += 8) {
    const batch = candidates.slice(offset, offset + 8);
    const modules = await Promise.allSettled(
      batch.map((modulePath) => fetchText(new URL(modulePath, ASSET_BASE).toString())),
    );
    for (const module of modules) {
      if (module.status !== "fulfilled") continue;
      const operationId = extractStaysSearchOperationId(module.value);
      if (operationId) return operationId;
    }
  }
  throw new UpstreamError(
    "operation_discovery_failed",
    "Airbnb StaysSearch operation ID could not be refreshed",
  );
}

export async function refreshStaysSearchOperationId(
  ctx: ExecutionContext,
): Promise<string> {
  const cached = await readThroughCache({
    namespace: "airbnb-stays-operation-v1",
    key: "StaysSearch",
    freshTtlSeconds: 24 * 60 * 60,
    staleTtlSeconds: 7 * 24 * 60 * 60,
    requireFresh: true,
    ctx,
    load: discoverOperationId,
  });
  return cached.value;
}
