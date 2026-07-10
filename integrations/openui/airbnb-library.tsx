"use client";

import {
  createLibrary,
  defineComponent,
  Renderer,
  type McpClientLike,
} from "@openuidev/react-lang";
import { z } from "zod/v4";

const Listing = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string(),
  price: z.object({
    currency: z.string(),
    total: z.number().nullable(),
    nightly: z.number().nullable(),
  }),
  rating: z.number().nullable(),
  images: z.array(z.object({ url: z.string(), alt: z.string() })),
  guest_favorite: z.boolean(),
  check_in: z.string(),
  check_out: z.string(),
  nights: z.number(),
});

export const AirbnbStayResults = defineComponent({
  name: "AirbnbStayResults",
  description:
    "Renders canonical listing cards returned by pyairbnb search_stays or search_flexible_stays.",
  props: z.object({
    title: z.string(),
    listings: z.array(Listing),
  }),
  component: ({ props }) => (
    <section aria-label={props.title} className="pyairbnb-openui-grid">
      <h2>{props.title}</h2>
      <div className="pyairbnb-openui-grid__items">
        {props.listings.map((listing) => (
          <article key={listing.id} className="pyairbnb-openui-card">
            <a href={listing.url} target="_blank" rel="noreferrer">
              {listing.images[0] ? (
                <img src={listing.images[0].url} alt={listing.images[0].alt} />
              ) : null}
              <h3>{listing.name}</h3>
              <p>
                {listing.price.total === null
                  ? "Price unavailable"
                  : new Intl.NumberFormat("en", {
                      style: "currency",
                      currency: listing.price.currency,
                    }).format(listing.price.total)}{" "}
                total
              </p>
              <p>{listing.rating === null ? "No rating shown" : `★ ${listing.rating}`}</p>
            </a>
          </article>
        ))}
      </div>
    </section>
  ),
});

export const pyairbnbOpenUiLibrary = createLibrary({
  root: "AirbnbStayResults",
  components: [AirbnbStayResults],
});

export const pyairbnbOpenUiExample = `data = Query("search_stays", {location: "Tampa, Florida", check_in: "2026-07-17", check_out: "2026-07-19", adults: 2, currency: "USD", limit: 12}, {listings: []})
root = AirbnbStayResults("Airbnb stays", data.listings)`;

export interface PyAirbnbOpenUiProps {
  response: string | null;
  isStreaming?: boolean;
  toolProvider:
    | Record<string, (args: Record<string, unknown>) => Promise<unknown>>
    | McpClientLike;
}

/** Complete OpenUI Lang renderer wired to either an MCP client or function map. */
export function PyAirbnbOpenUi({
  response,
  isStreaming = false,
  toolProvider,
}: PyAirbnbOpenUiProps) {
  return (
    <Renderer
      response={response}
      library={pyairbnbOpenUiLibrary}
      isStreaming={isStreaming}
      toolProvider={toolProvider}
      queryLoader={<p role="status">Searching Airbnb…</p>}
    />
  );
}

export function createPyAirbnbRestToolProvider(
  endpoint: string,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const origin = endpoint.replace(/\/$/, "");
  const call = async (path: string, args: Record<string, unknown>) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error(`pyairbnb returned HTTP ${response.status}`);
    return response.json();
  };
  return {
    search_stays: (args) => call("/v1/stays/search", args),
    search_flexible_stays: (args) => call("/v1/stays/flexible", args),
  };
}
