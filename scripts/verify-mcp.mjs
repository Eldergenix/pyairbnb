import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] ?? "http://127.0.0.1:8788/mcp";
const discoveryOnly = process.argv.includes("--discovery-only");

function isoDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const client = new Client({ name: "pyairbnb-verifier", version: "1.0.0" });
const startedAt = performance.now();

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
  const tools = await client.listTools();
  const resources = await client.listResources();
  const widget = await client.readResource({ uri: "ui://pyairbnb/stays-v1.html" });
  let search = null;
  if (!discoveryOnly) {
    const searchStartedAt = performance.now();
    const result = await client.callTool({
      name: "search_stays",
      arguments: {
        bounds: {
          northeast_latitude: 28.17,
          northeast_longitude: -82.25,
          southwest_latitude: 27.81,
          southwest_longitude: -82.65,
        },
        check_in: isoDaysFromNow(14),
        check_out: isoDaysFromNow(16),
        adults: 2,
        currency: "USD",
        limit: 5,
      },
    });
    const structured = result.structuredContent ?? {};
    search = {
      wall_ms: Math.round((performance.now() - searchStartedAt) * 10) / 10,
      count: structured.total_returned,
      cache: structured.cache,
      timing_ms: structured.timing_ms,
      first_id: structured.listings?.[0]?.id ?? null,
    };
  }
  console.log(JSON.stringify({
    endpoint,
    server: client.getServerVersion(),
    tool_names: tools.tools.map((tool) => tool.name),
    resource_mime: widget.contents[0]?.mimeType ?? null,
    resources: resources.resources.map((resource) => resource.uri),
    search,
    total_wall_ms: Math.round((performance.now() - startedAt) * 10) / 10,
  }));
} finally {
  await client.close();
}
