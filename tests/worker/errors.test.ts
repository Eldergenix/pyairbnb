import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  RequestError,
  UpstreamError,
  classifyPublicError,
} from "../../worker/src/errors.js";

describe("public error classification", () => {
  it("keeps validation detail but not internal exceptions", () => {
    const validation = z.object({ value: z.string() }).safeParse({ value: 1 });
    expect(validation.success).toBe(false);
    if (validation.success) return;
    expect(classifyPublicError(validation.error)).toMatchObject({
      status: 400,
      body: { error: "invalid_request" },
    });
    expect(classifyPublicError(new Error("secret upstream body"))).toEqual({
      status: 500,
      body: {
        error: "internal_error",
        message: "The request could not be completed",
        schema_version: "1.0",
      },
    });
  });

  it("maps request and upstream failures to stable statuses", () => {
    expect(
      classifyPublicError(new RequestError("invalid_date_range", "Bad dates")),
    ).toMatchObject({ status: 400, body: { error: "invalid_date_range" } });
    expect(
      classifyPublicError(
        new UpstreamError("upstream_timeout", "Airbnb request timed out", 504),
      ),
    ).toEqual({
      status: 504,
      body: {
        error: "upstream_timeout",
        message: "Airbnb request timed out",
        schema_version: "1.0",
      },
    });
  });
});
