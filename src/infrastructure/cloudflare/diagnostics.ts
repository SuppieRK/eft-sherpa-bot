type DiagnosticLevel = "info" | "warn" | "error";

export function logDiagnostic(
  level: DiagnosticLevel,
  code: string,
  details: Record<string, string | number | boolean | null> = {},
): void {
  const entry = JSON.stringify({
    component: "coffee-sherpa-bot",
    code,
    ...details,
  });
  console[level](entry);
}

export function safeDiagnosticErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[a-z0-9][a-z0-9_:.-]{0,63}$/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}
