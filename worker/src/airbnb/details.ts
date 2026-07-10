import { readThroughCache } from "../cache.js";
import { UpstreamError } from "../errors.js";
import type { DetailsInput, DetailsResult } from "../schemas.js";
import {
  AIRBNB_ORIGIN,
  QUOTE_OPERATION_ID,
  apiHeaders,
  encodeNodeId,
  fetchJson,
  withApiKeyRetry,
} from "./client.js";
import {
  array,
  deepFind,
  deepFindRecordWith,
  number,
  path,
  record,
  string,
} from "./payload.js";

const DETAIL_SECTION_IDS = [
  "TITLE_DEFAULT",
  "OVERVIEW_DEFAULT",
  "DESCRIPTION_DEFAULT",
  "AMENITIES_DEFAULT",
  "LOCATION_DEFAULT",
  "POLICIES_DEFAULT",
  "HOST_PROFILE_DEFAULT",
  "MEET_YOUR_HOST",
  "BOOK_IT_SIDEBAR",
];

type AmenityGroup = DetailsResult["amenity_groups"][number];
type ParsedDetails = Omit<
  DetailsResult,
  "listing_id" | "url" | "cache" | "timing_ms" | "fetched_at" | "schema_version"
>;

function extractAmenityGroups(payload: unknown): AmenityGroup[] {
  const groups = deepFind(payload, "seeAllAmenitiesGroups");
  return array(groups)
    .map((group) => {
      const groupRecord = record(group);
      const amenities = array(groupRecord?.amenities)
        .map((amenity) => {
          const item = record(amenity);
          const name = string(item?.title) || string(item?.name);
          if (!name) return null;
          return { name, available: item?.available !== false };
        })
        .filter((item): item is { name: string; available: boolean } => item !== null);
      return { title: string(groupRecord?.title), amenities };
    })
    .filter((group) => group.amenities.length > 0);
}

function extractHouseRules(payload: unknown): string[] {
  const rules = new Set<string>();
  for (const section of array(deepFind(payload, "houseRulesSections"))) {
    for (const item of array(record(section)?.items)) {
      const title = string(record(item)?.title);
      if (title) rules.add(title);
    }
  }
  const flat = deepFind(payload, "houseRules");
  if (typeof flat === "string" && flat) rules.add(flat);
  return [...rules];
}

function extractCoordinates(payload: unknown): DetailsResult["coordinates"] {
  const latitude = number(deepFind(payload, "lat"));
  const longitude = number(deepFind(payload, "lng"));
  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function extractPhotos(
  payload: unknown,
  title: string,
  sharing: Record<string, unknown> | null,
): DetailsResult["photos"] {
  const photos: DetailsResult["photos"] = [];
  const seen = new Set<string>();
  const candidates = [
    ...array(deepFind(payload, "mediaItems")),
    ...array(deepFind(payload, "previewImages")),
  ];
  for (const image of candidates) {
    const item = record(image);
    const url =
      string(item?.baseUrl) ||
      string(item?.picture) ||
      string(item?.imageUrl) ||
      string(item?.url);
    if (url && !seen.has(url)) {
      seen.add(url);
      photos.push({ url, alt: string(item?.accessibilityLabel) || title });
    }
  }
  if (photos.length === 0) {
    const single = string(sharing?.imageUrl);
    if (single) photos.push({ url: single, alt: title });
  }
  return photos.slice(0, 8);
}

function extractHost(payload: unknown): DetailsResult["host"] {
  const card = deepFindRecordWith(payload, ["isSuperhost"]) ??
    deepFindRecordWith(payload, ["isSuperHost"]);
  return {
    name:
      string(card?.name) ||
      string(card?.smartName) ||
      string(deepFind(payload, "hostName")),
    is_superhost: card?.isSuperhost === true || card?.isSuperHost === true,
    photo:
      string(card?.profilePictureUrl) ||
      string(card?.avatarUrl) ||
      string(deepFind(payload, "hostAvatarUrl")),
  };
}

function extractPrice(payload: unknown): DetailsResult["price"] {
  const priceData = record(deepFind(payload, "structuredDisplayPrice"));
  if (!priceData) return null;
  const primary = record(priceData.primaryLine);
  const display =
    string(primary?.discountedPrice) ||
    string(primary?.price) ||
    string(primary?.originalPrice);
  if (!display) return null;
  return {
    total: null,
    nightly: null,
    display,
    original_display: string(primary?.originalPrice),
    qualifier: string(primary?.qualifier),
    line_items: [],
  };
}

function parseDetailsPayload(payload: unknown, input: DetailsInput): ParsedDetails {
  if (array(path(payload, ["errors"])).length > 0) {
    throw new UpstreamError(
      "upstream_graphql_error",
      "Airbnb details response included errors",
    );
  }
  const sections = record(
    path(payload, ["data", "presentation", "stayProductDetailPage", "sections"]),
  );
  if (!sections) {
    throw new UpstreamError(
      "upstream_schema_changed",
      "Airbnb details response was incomplete",
    );
  }
  const sharing = record(deepFind(sections, "sharingConfig"));
  const title = string(sharing?.title) || string(deepFind(sections, "title"));
  const description =
    string(record(deepFind(sections, "htmlDescription"))?.htmlText) ||
    string(deepFind(sections, "htmlText"));
  return {
    title,
    subtitle: string(sharing?.propertyTitle) || string(sharing?.location),
    description,
    coordinates: extractCoordinates(sections),
    person_capacity: number(sharing?.personCapacity),
    room_type: string(sharing?.propertyType) || string(sharing?.roomType),
    rating: number(sharing?.starRating) ?? number(deepFind(sections, "starRating")),
    review_count:
      number(sharing?.reviewCount) ?? number(deepFind(sections, "reviewCount")),
    amenity_groups: extractAmenityGroups(sections),
    house_rules: extractHouseRules(sections),
    host: extractHost(sections),
    photos: extractPhotos(sections, title, sharing),
    price: input.check_in && input.check_out ? extractPrice(sections) : null,
  };
}

function detailsVariables(input: DetailsInput): Record<string, unknown> {
  const sectionsRequest: Record<string, unknown> = {
    adults: String(input.adults),
    children: String(input.children),
    infants: String(input.infants),
    pets: input.pets,
    bypassTargetings: false,
    layouts: ["SIDEBAR", "SINGLE_COLUMN"],
    preview: false,
    privateBooking: false,
    useNewSectionWrapperApi: false,
    sectionIds: DETAIL_SECTION_IDS,
  };
  if (input.check_in && input.check_out) {
    sectionsRequest.checkIn = input.check_in;
    sectionsRequest.checkOut = input.check_out;
  }
  return {
    id: encodeNodeId("StayListing", input.listing_id),
    pdpSectionsRequest: sectionsRequest,
  };
}

async function loadDetails(input: DetailsInput, ctx: ExecutionContext) {
  const extensions = {
    persistedQuery: { version: 1, sha256Hash: QUOTE_OPERATION_ID },
  };
  const url = new URL(
    `/api/v3/StaysPdpSections/${QUOTE_OPERATION_ID}`,
    AIRBNB_ORIGIN,
  );
  url.searchParams.set("operationName", "StaysPdpSections");
  url.searchParams.set("locale", input.language);
  url.searchParams.set("currency", input.currency);
  url.searchParams.set("variables", JSON.stringify(detailsVariables(input)));
  url.searchParams.set("extensions", JSON.stringify(extensions));
  return withApiKeyRetry(ctx, async (apiKey) => {
    const payload = await fetchJson(url, { headers: apiHeaders(apiKey) });
    return parseDetailsPayload(payload, input);
  });
}

export async function getListingDetails(
  input: DetailsInput,
  ctx: ExecutionContext,
): Promise<DetailsResult> {
  const startedAt = performance.now();
  const cached = await readThroughCache({
    namespace: "listing-details-v1",
    key: { ...input, require_fresh: undefined },
    freshTtlSeconds: 30 * 60,
    staleTtlSeconds: 6 * 60 * 60,
    requireFresh: input.require_fresh,
    negativeTtlSeconds: 30,
    ctx,
    load: () => loadDetails(input, ctx),
  });
  const parsed = cached.value;
  return {
    listing_id: input.listing_id,
    url: `${AIRBNB_ORIGIN}/rooms/${input.listing_id}`,
    title: parsed.title,
    subtitle: parsed.subtitle,
    description: parsed.description,
    coordinates: parsed.coordinates,
    person_capacity: parsed.person_capacity,
    room_type: parsed.room_type,
    rating: parsed.rating,
    review_count: parsed.review_count,
    amenity_groups: parsed.amenity_groups,
    house_rules: parsed.house_rules,
    host: parsed.host,
    photos: parsed.photos,
    price: parsed.price,
    cache: cached.status,
    timing_ms: Math.round((performance.now() - startedAt) * 10) / 10,
    fetched_at: cached.fetchedAt,
    schema_version: "1.0",
  };
}
