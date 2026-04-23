# Vercel OpenTelemetry + trace drains (Braintrust)

This app registers OpenTelemetry via [`@vercel/otel`](https://vercel.com/docs/tracing/instrumentation) in [`src/instrumentation.ts`](../../src/instrumentation.ts).

## 1. Code (done in repo)

- `registerOTel({ serviceName })` runs at startup.
- Optional env: **`OTEL_SERVICE_NAME`** — set in Vercel if you want traces labeled differently (default `expert-network`).

## 2. Trace drain (Vercel Dashboard — not in git)

Trace Drains send OTLP/HTTP traces to an external sink. They are configured **per Vercel project** (e.g. `braintrust-coral-kettle`).

1. Open [Vercel Dashboard](https://vercel.com) → select your project.
2. **Settings** → **Drains** (or **Observability** → **Drains**, depending on UI).
3. **Add Drain** → choose **Native integration** → [Braintrust](https://vercel.com/marketplace/braintrust) (or **Custom endpoint** for OTLP/HTTP, port **4318**, path `/v1/traces`).
4. Complete the Braintrust / marketplace flow and add **sampling rules** if you want less than 100% of traffic.

References: [Using drains](https://vercel.com/docs/drains/using-drains), [Trace drains](https://vercel.com/docs/drains/reference/traces).

## Limitations (from Vercel)

- Custom spans from **Edge** runtime are not forwarded via Trace Drain.
- Drains use **OTLP/HTTP** only (not gRPC `:4317`).
