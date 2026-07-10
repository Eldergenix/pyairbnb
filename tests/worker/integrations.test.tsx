import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PyAirbnbOpenUi,
  createPyAirbnbRestToolProvider,
} from "../../integrations/openui/airbnb-library.js";
import { AirbnbListingGrid } from "../../integrations/rsc/AirbnbListingGrid.js";

const listing = {
  id: "123",
  url: "https://www.airbnb.com/rooms/123",
  name: "Fast Tampa stay",
  location: { latitude: 27.95, longitude: -82.46 },
  price: { currency: "USD", total: 300, nightly: 150 },
  rating: 4.9,
  images: [{ url: "https://a0.muscache.com/test.jpg", alt: "Stay" }],
  guest_favorite: true,
  check_in: "2026-07-17",
  check_out: "2026-07-19",
  nights: 2,
};

afterEach(() => vi.unstubAllGlobals());

describe("rendering adapters", () => {
  it("renders the async RSC adapter from validated Worker data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          listings: [listing],
          total_returned: 1,
          cache: "hit",
          timing_ms: 4,
        }),
      ),
    );
    const element = await AirbnbListingGrid({
      endpoint: "https://pyairbnb.test",
      query: {
        location: "Tampa",
        check_in: "2026-07-17",
        check_out: "2026-07-19",
      },
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Fast Tampa stay");
    expect(html).toContain("$300.00");
  });

  it("renders OpenUI Lang and exposes a working REST tool provider", async () => {
    const response = 'root = AirbnbStayResults("Tampa stays", [])';
    const provider = createPyAirbnbRestToolProvider("https://pyairbnb.test");
    const html = renderToStaticMarkup(
      <PyAirbnbOpenUi response={response} toolProvider={provider} />,
    );
    expect(html).toContain("Tampa stays");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ listings: [listing] })));
    await expect(
      provider.search_stays?.({
        location: "Tampa",
        check_in: "2026-07-17",
        check_out: "2026-07-19",
      }),
    ).resolves.toMatchObject({ listings: [{ id: "123" }] });
  });
});
