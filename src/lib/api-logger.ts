import { randomUUID } from "crypto";

type RequestLike = {
  headers: Headers;
  method: string;
  url: string;
};

type ApiLogLevel = "info" | "warn" | "error";

function getRequestPath(request: RequestLike): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.url;
  }
}

export function getRequestId(request: RequestLike): string {
  return request.headers.get("x-request-id") || randomUUID();
}

export function apiLog(
  level: ApiLogLevel,
  scope: string,
  event: string,
  request: RequestLike,
  fields: Record<string, unknown> = {},
): void {
  const payload = {
    scope,
    event,
    requestId: getRequestId(request),
    method: request.method,
    path: getRequestPath(request),
    ...fields,
  };

  console[level](`[${scope}] ${event}`, payload);
}
