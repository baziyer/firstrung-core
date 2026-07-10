import { isAbsolute, relative, resolve } from "node:path";

import type { JsonObject } from "@firstrung/schema";

import {
  resolveApprovedCoachSnippets,
  type CoachContext,
  type SelectedCoachSnippet
} from "./coachContext.js";
import type { PiSdkBindings, PiToolDefinition, PiToolResult } from "./piSdk.js";
import {
  runVerificationCommand,
  type VerificationCommandRunner,
  type VerificationCommandId
} from "./verificationRunner.js";
import { FIRSTRUNG_PI_COACH_TOOL_NAMES } from "./toolProfile.js";

export interface FirstRungCoachToolOptions {
  context: CoachContext;
  repoRoot: string;
  outDir: string;
  sessionId: string;
  approvedCommandIds?: readonly string[] | ReadonlySet<string>;
  commandRunner?: VerificationCommandRunner;
  verificationTimeoutMs?: number;
  approvedFiles?: readonly JsonObject[];
  selectedSnippets?: readonly SelectedCoachSnippet[];
  approvedSnippetIds?: readonly string[];
}

export function buildFirstRungCustomTools(
  bindings: PiSdkBindings,
  options: FirstRungCoachToolOptions
): PiToolDefinition[] {
  const definitions: Record<(typeof FIRSTRUNG_PI_COACH_TOOL_NAMES)[number], PiToolDefinition> = {
    firstrung_read_scan_artifact: tool("firstrung_read_scan_artifact", async () =>
      textResult(JSON.stringify({ summary: options.context.summary, disclosure: options.context.disclosure }, null, 2), {
        rawContentIncluded: false
      })
    ),
    firstrung_list_project_files: tool("firstrung_list_project_files", async () =>
      textResult(JSON.stringify(approvedFileMetadata(options), null, 2), {
        rawContentIncluded: false,
        source: "approved_file_metadata"
      })
    ),
    firstrung_read_approved_file: tool("firstrung_read_approved_file", async (_toolCallId, params) => {
      const snippet = findSelectedSnippet(selectedSnippetViews(options), params);

      if (!snippet) {
        return textResult("Selected snippet is not available. Raw project file reads are not permitted.", {
          denied: true,
          rawContentIncluded: false
        });
      }

      return textResult(snippet.text, {
        rawDataDisclosure: "selected",
        rawSnippetConsent: true,
        snippetId: snippet.id,
        snippetLabel: snippet.label
      });
    }),
    firstrung_search_approved_files: tool("firstrung_search_approved_files", async (_toolCallId, params) => {
      const query = stringParam(params, "query").toLowerCase();
      const files = approvedFileMetadata(options).filter((file) => JSON.stringify(file).toLowerCase().includes(query));
      const snippets = selectedSnippetViews(options)
        .filter((snippet) => `${snippet.id} ${snippet.label} ${snippet.text}`.toLowerCase().includes(query))
        .map((snippet) => ({
          id: snippet.id,
          label: snippet.label,
          textMetadata: {
            included: false,
            summary: "selected snippet text available through firstrung_read_approved_file by id",
            characterCount: snippet.text.length
          }
        }));

      return textResult(JSON.stringify({ files, snippets }, null, 2), {
        rawContentIncluded: false,
        filesystemSearched: false
      });
    }),
    firstrung_verify: tool("firstrung_verify", async (_toolCallId, params) => {
      const commandId = stringParam(params, "commandId") as VerificationCommandId | string;
      const result = await runVerificationCommand({
        commandId,
        cwd: options.repoRoot,
        projectId: options.context.summary.projectId,
        sessionId: options.sessionId,
        ...(options.approvedCommandIds ? { approvedCommandIds: options.approvedCommandIds } : {}),
        ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
        ...(options.verificationTimeoutMs === undefined ? {} : { timeoutMs: options.verificationTimeoutMs })
      });

      return textResult(result.summary, {
        commandId,
        status: result.status,
        rawCommandOutputIncluded: result.rawCommandOutputIncluded,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
        eventSummaries: result.events.map((event) => event.summary)
      });
    })
  };

  return FIRSTRUNG_PI_COACH_TOOL_NAMES.map((name) => bindings.defineTool(definitions[name]));
}

function tool(
  name: (typeof FIRSTRUNG_PI_COACH_TOOL_NAMES)[number],
  execute: NonNullable<PiToolDefinition["execute"]>
): PiToolDefinition {
  return {
    name,
    label: name,
    description: "FirstRung coach tool. Uses only allowlisted context, explicitly consented snippets, or fixed verification commands.",
    executionMode: "sequential",
    execute
  };
}

function textResult(text: string, details: Record<string, unknown> = {}): PiToolResult {
  return {
    content: [{ type: "text", text }],
    details
  };
}

function approvedFileMetadata(options: FirstRungCoachToolOptions): JsonObject[] {
  return options.context.approvedFiles.map((file) => ({
    ...(typeof file.id === "string" ? { id: file.id } : {}),
    ...(typeof file.path === "string" ? { path: file.path } : {}),
    ...(typeof file.label === "string" ? { label: file.label } : {})
  }));
}

interface SelectedSnippetView extends SelectedCoachSnippet {}

function selectedSnippetViews(options: FirstRungCoachToolOptions): SelectedSnippetView[] {
  const approved = resolveApprovedCoachSnippets(options.selectedSnippets ?? [], options.approvedSnippetIds ?? []);
  return approved.map((snippet, index) => ({
    id: options.context.selectedSnippets?.[index]?.id ?? `snippet_${index + 1}`,
    label: options.context.selectedSnippets?.[index]?.label ?? `Selected snippet ${index + 1}`,
    text: snippet.text
  }));
}

function findSelectedSnippet(snippets: readonly SelectedSnippetView[], params: Record<string, unknown>): SelectedSnippetView | undefined {
  const id = stringParam(params, "id");
  const label = stringParam(params, "label");
  return snippets.find((snippet) => (id.length > 0 && snippet.id === id) || (label.length > 0 && snippet.label === label));
}

function stringParam(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

export interface PathSemantics {
  resolve(...pathSegments: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(path: string): boolean;
}

const defaultPathSemantics: PathSemantics = {
  resolve,
  relative,
  isAbsolute
};

export function isPathWithinOrEqual(path: string, outDir: string, pathApi: PathSemantics = defaultPathSemantics): boolean {
  const resolvedPath = pathApi.resolve(path);
  const resolvedOutDir = pathApi.resolve(outDir);
  const relativePath = pathApi.relative(resolvedOutDir, resolvedPath);

  return relativePath === "" || (relativePath.length > 0 && !relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath));
}
