import { describe, expect, it } from "vitest";
import {
  extractStaysSearchOperationId,
  hasPersistedQueryError,
} from "../../worker/src/airbnb/operation-id.js";

describe("persisted operation recovery", () => {
  it("extracts a StaysSearch operation ID from current bundle shapes", () => {
    const hash = "a".repeat(64);
    expect(
      extractStaysSearchOperationId(
        `operationName:"StaysSearch",operationId:"${hash}"`,
      ),
    ).toBe(hash);
    expect(
      extractStaysSearchOperationId(`/api/v3/StaysSearch/${hash}`),
    ).toBe(hash);
  });

  it("retries only persisted-query failures", () => {
    expect(
      hasPersistedQueryError({
        errors: [{ message: "PersistedQueryNotFound", extensions: { code: "PERSISTED_QUERY_NOT_FOUND" } }],
      }),
    ).toBe(true);
    expect(hasPersistedQueryError({ errors: [{ message: "Invalid guest count" }] })).toBe(false);
  });
});
