import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { compactTextPayload } from "../../worker/src/index.js";

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const response = await exports.default.fetch(
    new Request("https://pyairbnb.test/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  const text = await response.text();
  if (response.headers.get("Content-Type")?.includes("text/event-stream")) {
    const data = text
      .split("\n")
      .find((line) => line.startsWith("data:"))
      ?.slice(5)
      .trim();
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(text);
}

describe("MCP result compatibility", () => {
  it("classifies malformed and oversized REST bodies", async () => {
    const malformed = await exports.default.fetch(
      new Request("https://pyairbnb.test/v1/stays/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ error: "invalid_json" });

    const oversized = await exports.default.fetch(
      new Request("https://pyairbnb.test/v1/stays/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(70_000) }),
      }),
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({ error: "request_too_large" });
  });

  it("runs initialize, discovery, resource read, and tool validation in workerd", async () => {
    const initialized = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pyairbnb-test", version: "1.0.0" },
    });
    expect(initialized).toMatchObject({ result: { serverInfo: { name: "pyairbnb" } } });

    const tools = await rpc("tools/list");
    expect(tools).toMatchObject({
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "search_stays" }),
          expect.objectContaining({ name: "search_flexible_stays" }),
        ]),
      },
    });

    const resources = await rpc("resources/list");
    expect(resources).toMatchObject({
      result: {
        resources: expect.arrayContaining([
          expect.objectContaining({ uri: "ui://pyairbnb/stays-v1.html" }),
        ]),
      },
    });
    const resource = await rpc("resources/read", {
      uri: "ui://pyairbnb/stays-v1.html",
    });
    expect(resource).toMatchObject({
      result: {
        contents: expect.arrayContaining([
          expect.objectContaining({ mimeType: "text/html;profile=mcp-app" }),
        ]),
      },
    });

    const invalidCall = await rpc("tools/call", {
      name: "search_stays",
      arguments: {
        check_in: "2026-07-17",
        check_out: "2026-07-19",
      },
    });
    expect(invalidCall).toMatchObject({ result: { isError: true } });
  });

  it("keeps canonical cards in structured content while compacting text fallback", () => {
    const compact = compactTextPayload({
      query: { location: "Tampa" },
      listings: [
        {
          id: "123",
          name: "Example stay",
          url: "https://www.airbnb.com/rooms/123",
          images: [{ url: "https://a0.muscache.com/large-image.jpg" }],
          location: { latitude: 1, longitude: 2 },
          price: { currency: "USD", total: 300, nightly: 150 },
          rating: 4.9,
          review_count: 20,
          guest_favorite: true,
          check_in: "2026-07-17",
          check_out: "2026-07-19",
          nights: 2,
        },
      ],
      total_returned: 1,
      schema_version: "1.0",
    });
    const serialized = JSON.stringify(compact);
    expect(serialized).toContain('"id":"123"');
    expect(serialized).not.toContain("muscache");
    expect(serialized).not.toContain("latitude");
  });
});
