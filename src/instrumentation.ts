import { registerOTel } from "@vercel/otel";

/**
 * OpenTelemetry bootstrap for Vercel (Node serverless + trace drains).
 * @see https://vercel.com/docs/tracing/instrumentation
 * @see https://nextjs.org/docs/app/guides/open-telemetry
 */
export function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "expert-network",
  });
}
