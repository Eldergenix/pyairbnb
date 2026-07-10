import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  coalescedLoad,
  readThroughCache,
  stableJson,
} from "../../worker/src/cache.js";

describe("stableJson", () => {
  it("creates identical cache keys for objects with different insertion order", () => {
    expect(stableJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it("preserves array ordering because result order is semantic", () => {
    expect(stableJson({ values: [1, 2] })).not.toBe(
      stableJson({ values: [2, 1] }),
    );
  });
});

describe("coalescedLoad", () => {
  it("shares one in-flight load across concurrent identical requests", async () => {
    let loads = 0;
    const values = await Promise.all(
      Array.from({ length: 20 }, () =>
        coalescedLoad("same-key", async () => {
          loads += 1;
          await Promise.resolve();
          return { value: 42 };
        }),
      ),
    );
    expect(loads).toBe(1);
    expect(values.every((value) => value.value === 42)).toBe(true);
  });

  it("clears failed loads so a later request can recover", async () => {
    await expect(
      coalescedLoad("recoverable", async () => {
        throw new Error("temporary");
      }),
    ).rejects.toThrow("temporary");
    await expect(coalescedLoad("recoverable", async () => "ok")).resolves.toBe("ok");
  });
});

describe("Cache API integration", () => {
  it("writes a miss and serves the next identical query as a hit", async () => {
    let loads = 0;
    const firstContext = createExecutionContext();
    const first = await readThroughCache({
      namespace: "test-hit-v1",
      key: { query: "unique-hit" },
      freshTtlSeconds: 60,
      staleTtlSeconds: 120,
      requireFresh: false,
      ctx: firstContext,
      load: async () => {
        loads += 1;
        return { value: 7 };
      },
    });
    await waitOnExecutionContext(firstContext);

    const secondContext = createExecutionContext();
    const second = await readThroughCache({
      namespace: "test-hit-v1",
      key: { query: "unique-hit" },
      freshTtlSeconds: 60,
      staleTtlSeconds: 120,
      requireFresh: false,
      ctx: secondContext,
      load: async () => {
        loads += 1;
        return { value: 8 };
      },
    });
    await waitOnExecutionContext(secondContext);

    expect(first.status).toBe("miss");
    expect(second).toMatchObject({ status: "hit", value: { value: 7 } });
    expect(loads).toBe(1);
  });

  it("returns stale data immediately when background refresh fails", async () => {
    const seedContext = createExecutionContext();
    await readThroughCache({
      namespace: "test-stale-v1",
      key: "unique-stale",
      freshTtlSeconds: 0,
      staleTtlSeconds: 60,
      requireFresh: false,
      ctx: seedContext,
      load: async () => "seed",
    });
    await waitOnExecutionContext(seedContext);

    const staleContext = createExecutionContext();
    const stale = await readThroughCache({
      namespace: "test-stale-v1",
      key: "unique-stale",
      freshTtlSeconds: 0,
      staleTtlSeconds: 60,
      requireFresh: false,
      ctx: staleContext,
      load: async () => {
        throw new Error("temporary origin failure");
      },
    });
    await waitOnExecutionContext(staleContext);

    expect(stale).toMatchObject({ status: "stale", value: "seed", stale: true });
  });
});
