import { D1Metrics, instrumentD1Database } from "./d1-metrics";
import { logDiagnostic } from "./diagnostics";
import type { CloudflareEnvironment } from "./environment";

type InvocationOutcome = "ok" | "client_error" | "server_error" | "exception";

function requestClass(request: Request): { route: string; requestClass: string } {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/health") {
    return { route: "/health", requestClass: "health" };
  }
  if (request.method === "POST" && pathname === "/webhooks/discord/interactions") {
    return { route: "/webhooks/discord/interactions", requestClass: "discord_interaction" };
  }
  if (request.method === "POST" && pathname === "/webhooks/twitch/eventsub") {
    return { route: "/webhooks/twitch/eventsub", requestClass: "twitch_eventsub" };
  }
  if (request.method === "GET" && pathname === "/internal/status") {
    return { route: "/internal/status", requestClass: "operator_diagnostic" };
  }
  return { route: "unmatched", requestClass: "unmatched" };
}

function measuredEnvironment(environment: CloudflareEnvironment, metrics: D1Metrics) {
  return { ...environment, DB: instrumentD1Database(environment.DB, metrics) };
}

function usageDetails(metrics: D1Metrics, startedAt: number) {
  const usage = metrics.snapshot();
  return {
    wallTimeMs: Date.now() - startedAt,
    d1Statements: usage.statements,
    d1DurationMs: Number(usage.durationMs.toFixed(3)),
    d1RowsRead: usage.rowsRead,
    d1RowsWritten: usage.rowsWritten,
  };
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /overloaded/i.test(error.message)) {
    return "d1_overloaded";
  }
  return "unexpected_error";
}

export async function observeWorkerRequest(
  request: Request,
  environment: CloudflareEnvironment,
  handler: (measured: CloudflareEnvironment) => Promise<Response>,
): Promise<Response> {
  const startedAt = Date.now();
  const metrics = new D1Metrics();
  const classification = requestClass(request);
  try {
    const response = await handler(measuredEnvironment(environment, metrics));
    let outcome: InvocationOutcome = "ok";
    if (response.status >= 500) {
      outcome = "server_error";
    } else if (response.status >= 400) {
      outcome = "client_error";
    }
    logDiagnostic(outcome === "server_error" ? "error" : "info", "worker_invocation", {
      ...classification,
      outcome,
      status: response.status,
      ...usageDetails(metrics, startedAt),
    });
    return response;
  } catch (error) {
    logDiagnostic("error", "worker_invocation", {
      ...classification,
      outcome: "exception",
      errorClass: error instanceof Error ? error.name : "unknown",
      errorCode: safeErrorCode(error),
      ...usageDetails(metrics, startedAt),
    });
    throw error;
  }
}
