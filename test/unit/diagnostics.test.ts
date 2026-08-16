import { describe, expect, it } from "vitest";
import { safeDiagnosticErrorCode } from "../../src/infrastructure/cloudflare/diagnostics";

describe("diagnostic error codes", () => {
  it("keeps stable codes and replaces free-form error content", () => {
    expect(safeDiagnosticErrorCode(new Error("backup_configuration_missing"), "fallback")).toBe(
      "backup_configuration_missing",
    );
    expect(
      safeDiagnosticErrorCode(new Error("failed for private-note and user 123"), "safe_fallback"),
    ).toBe("safe_fallback");
  });
});
