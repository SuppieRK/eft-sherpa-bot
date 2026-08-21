import { D1Metrics, instrumentD1Database } from "./d1-metrics";
import { logDiagnostic } from "./diagnostics";
import type { CloudflareEnvironment } from "./environment";

type InvocationOutcome = "ok" | "client_error" | "server_error" | "exception";

export interface TrackedExecutionContext extends ExecutionContext {
  waitUntilTask(name: string, task: (environment: CloudflareEnvironment) => Promise<unknown>): void;
}

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
    d1BindingCalls: usage.bindingCalls,
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

function addUsage(target: D1Metrics, usage: ReturnType<D1Metrics["snapshot"]>): void {
  target.add(usage);
}

function trackedExecutionContext(input: {
  context: ExecutionContext;
  environment: CloudflareEnvironment;
  correlationId: string;
  classification: { route: string; requestClass: string };
  tasks: Promise<void>[];
  taskMetrics: D1Metrics[];
}): TrackedExecutionContext {
  const waitUntilTask = (
    name: string,
    task: (environment: CloudflareEnvironment) => Promise<unknown>,
  ) => {
    const startedAt = Date.now();
    const metrics = new D1Metrics();
    input.taskMetrics.push(metrics);
    const work = task(measuredEnvironment(input.environment, metrics)).then(
      () => {
        logDiagnostic("info", "worker_background_task", {
          ...input.classification,
          correlationId: input.correlationId,
          task: name,
          outcome: "ok",
          ...usageDetails(metrics, startedAt),
        });
      },
      (error: unknown) => {
        logDiagnostic("error", "worker_background_task", {
          ...input.classification,
          correlationId: input.correlationId,
          task: name,
          outcome: "exception",
          errorClass: error instanceof Error ? error.name : "unknown",
          errorCode: safeErrorCode(error),
          ...usageDetails(metrics, startedAt),
        });
      },
    );
    input.tasks.push(work);
    input.context.waitUntil(work);
  };
  return new Proxy(input.context as TrackedExecutionContext, {
    get(target, property) {
      if (property === "waitUntilTask") return waitUntilTask;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function observeWorkerRequest(
  request: Request,
  environment: CloudflareEnvironment,
  context: ExecutionContext,
  handler: (
    measured: CloudflareEnvironment,
    trackedContext: TrackedExecutionContext,
  ) => Promise<Response>,
): Promise<Response> {
  const startedAt = Date.now();
  const metrics = new D1Metrics();
  const classification = requestClass(request);
  const correlationId = crypto.randomUUID();
  const tasks: Promise<void>[] = [];
  const taskMetrics: D1Metrics[] = [];
  const trackedContext = trackedExecutionContext({
    context,
    environment,
    correlationId,
    classification,
    tasks,
    taskMetrics,
  });
  const settleTrackedTasks = async () => {
    let settledCount = 0;
    while (settledCount < tasks.length) {
      const pending = tasks.slice(settledCount);
      settledCount = tasks.length;
      // Later tasks can schedule more tracked work, so each generation must settle in order.
      // oxlint-disable-next-line no-await-in-loop
      await Promise.allSettled(pending);
    }
  };
  const scheduleFinalUsage = (outcome: InvocationOutcome) => {
    const foreground = metrics.snapshot();
    context.waitUntil(
      settleTrackedTasks().then(() => {
        const aggregate = new D1Metrics();
        addUsage(aggregate, foreground);
        for (const taskMetric of taskMetrics) addUsage(aggregate, taskMetric.snapshot());
        logDiagnostic("info", "worker_invocation_final", {
          ...classification,
          correlationId,
          outcome,
          trackedTaskCount: tasks.length,
          ...usageDetails(aggregate, startedAt),
        });
      }),
    );
  };
  try {
    const response = await handler(measuredEnvironment(environment, metrics), trackedContext);
    let outcome: InvocationOutcome = "ok";
    if (response.status >= 500) {
      outcome = "server_error";
    } else if (response.status >= 400) {
      outcome = "client_error";
    }
    logDiagnostic(outcome === "server_error" ? "error" : "info", "worker_invocation", {
      ...classification,
      correlationId,
      scope: "foreground",
      outcome,
      status: response.status,
      ...usageDetails(metrics, startedAt),
    });
    scheduleFinalUsage(outcome);
    return response;
  } catch (error) {
    logDiagnostic("error", "worker_invocation", {
      ...classification,
      correlationId,
      scope: "foreground",
      outcome: "exception",
      errorClass: error instanceof Error ? error.name : "unknown",
      errorCode: safeErrorCode(error),
      ...usageDetails(metrics, startedAt),
    });
    scheduleFinalUsage("exception");
    throw error;
  }
}
