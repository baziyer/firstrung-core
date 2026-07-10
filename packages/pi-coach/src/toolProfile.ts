export const FIRSTRUNG_PI_COACH_TOOL_NAMES = [
  "firstrung_read_scan_artifact",
  "firstrung_list_project_files",
  "firstrung_read_approved_file",
  "firstrung_search_approved_files",
  "firstrung_verify"
] as const;

export const DISALLOWED_PI_TOOL_NAMES = ["bash", "edit", "write", "delete", "patch", "grep", "find", "ls"] as const;

export interface PiCoachToolRegistryProfileInput {
  activeToolNames: readonly string[];
  registryVisibleToolNames: readonly string[];
}

export function sortedToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames)].sort((left, right) => left.localeCompare(right));
}

export function assertPiCoachToolRegistryMatchesProfile(input: PiCoachToolRegistryProfileInput): void {
  const allowed = sortedToolNames(FIRSTRUNG_PI_COACH_TOOL_NAMES);
  const active = sortedToolNames(input.activeToolNames);
  const visible = sortedToolNames(input.registryVisibleToolNames);

  assertNoDisallowedTools(active, "active");
  assertNoDisallowedTools(visible, "visible");
  assertExactToolSet(active, allowed, "active");
  assertExactToolSet(visible, allowed, "visible");
}

function assertNoDisallowedTools(toolNames: readonly string[], source: string): void {
  const disallowed = toolNames.filter((toolName) => (DISALLOWED_PI_TOOL_NAMES as readonly string[]).includes(toolName));

  if (disallowed.length > 0) {
    throw new Error(
      `FirstRung Coach ${source} registry exposes disallowed Pi tool(s): ${disallowed.join(
        ", "
      )}. Disable shell, file mutation, and generic filesystem tools before starting firstrung-coach.`
    );
  }
}

function assertExactToolSet(actual: readonly string[], expected: readonly string[], source: string): void {
  const unexpected = actual.filter((toolName) => !expected.includes(toolName));
  const missing = expected.filter((toolName) => !actual.includes(toolName));

  if (unexpected.length > 0) {
    throw new Error(
      `FirstRung Coach ${source} registry includes unexpected FirstRung Coach tool(s): ${unexpected.join(
        ", "
      )}. Expected only: ${expected.join(", ")}.`
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `FirstRung Coach ${source} registry is missing required FirstRung Coach tool(s): ${missing.join(
        ", "
      )}. Register the full FirstRung allowlist before starting firstrung-coach.`
    );
  }
}
