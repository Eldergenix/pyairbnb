import { z } from "zod";

interface PublicErrorBody {
  error: string;
  message?: string;
  issues?: z.core.$ZodIssue[];
  schema_version: "1.0";
}

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export class UpstreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 502,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export function classifyPublicError(error: unknown): {
  status: number;
  body: PublicErrorBody;
} {
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: {
        error: "invalid_request",
        issues: error.issues,
        schema_version: "1.0",
      },
    };
  }
  if (error instanceof RequestError || error instanceof UpstreamError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message,
        schema_version: "1.0",
      },
    };
  }
  return {
    status: 500,
    body: {
      error: "internal_error",
      message: "The request could not be completed",
      schema_version: "1.0",
    },
  };
}
