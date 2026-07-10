import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "../../worker/src/errors.js";
import {
  fetchJson,
  withApiKeyRetry,
} from "../../worker/src/airbnb/client.js";

afterEach(() => vi.unstubAllGlobals());

describe("Airbnb client recovery", () => {
  it("classifies expired public API credentials separately", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    await expect(fetchJson("https://www.airbnb.com/api/test")).rejects.toMatchObject({
      code: "upstream_auth",
    });
  });

  it("classifies a body-read abort as an upstream timeout", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("The operation was aborted due to timeout"));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));
    await expect(fetchJson("https://www.airbnb.com/api/test")).rejects.toMatchObject({
      code: "upstream_timeout",
      status: 504,
    });
  });

  it("refreshes the public API key once after an auth failure", async () => {
    let bootstraps = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        bootstraps += 1;
        const key = bootstraps === 1 ? "old-public-key" : "new-public-key";
        return new Response(`{"api_config":{"key":"${key}"}}`);
      }),
    );
    const context = createExecutionContext();
    const seen: string[] = [];
    const result = await withApiKeyRetry(context, async (apiKey) => {
      seen.push(apiKey);
      if (apiKey === "old-public-key") {
        throw new UpstreamError("upstream_auth", "Expired key", 502);
      }
      return apiKey;
    });
    await waitOnExecutionContext(context);

    expect(result).toBe("new-public-key");
    expect(seen).toEqual(["old-public-key", "new-public-key"]);
    expect(bootstraps).toBe(2);
  });
});
