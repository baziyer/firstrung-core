import type { JsonValue } from "@firstrung/schema";

import { assertNodeSupportsPiCoach } from "./nodeVersion.js";

const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";

export interface PiToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
}

export interface PiToolDefinition {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: unknown;
  renderShell?: "default" | "self";
  executionMode?: "sequential" | "parallel";
  execute?(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown
  ): PiToolResult | Promise<PiToolResult>;
  renderCall?(args: Record<string, unknown>, theme: unknown, context: unknown): unknown;
  renderResult?(
    result: PiToolResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: unknown,
    context: unknown
  ): unknown;
}

export interface PiSessionStreamEvent {
  type: string;
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
  message?: unknown;
  messages?: readonly unknown[];
  willRetry?: boolean;
  toolName?: string;
  toolCallId?: string;
  result?: unknown;
  error?: unknown;
}

export interface PiSessionPromptOptions {
  streamingBehavior?: "steer" | "followUp";
  source?: "interactive" | "rpc" | "extension";
  preflightResult?: (success: boolean) => void;
  metadata?: Record<string, JsonValue>;
  events?: readonly unknown[];
}

export interface PiSession {
  readonly isStreaming?: boolean;
  readonly model?: {
    provider?: string;
    id?: string;
    modelId?: string;
  };
  readonly state?: {
    messages?: readonly unknown[];
  };
  getActiveToolNames(): string[];
  getAllTools(): Array<{ name: string }>;
  getToolDefinition?(name: string): PiToolDefinition | undefined;
  subscribe?(listener: (event: PiSessionStreamEvent) => void): () => void;
  prompt?(text: string, options?: PiSessionPromptOptions): Promise<void>;
  abort?(): Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface PiAuthStorage {
  hasAuth?(provider: string): boolean;
}

export interface PiModelRegistry {
  find?(provider: string, modelId: string): unknown;
}

export interface PiSdkBindings {
  AuthStorage: {
    inMemory(data?: unknown): PiAuthStorage;
    create?(authPath?: string): PiAuthStorage;
  };
  ModelRegistry: {
    inMemory(authStorage: unknown): PiModelRegistry;
  };
  SessionManager: {
    inMemory(cwd?: string): unknown;
    create?(cwd: string, sessionDir?: string): unknown;
  };
  SettingsManager: {
    inMemory(settings?: Record<string, unknown>): unknown;
  };
  createAgentSession(options: Record<string, unknown>): Promise<{
    session: PiSession;
    extensionsResult: { extensions: unknown[]; errors: unknown[] };
    modelFallbackMessage?: string;
  }>;
  createExtensionRuntime(): unknown;
  defineTool<TTool extends PiToolDefinition>(definition: TTool): TTool;
  Theme: new (
    fgColors: Record<string, string>,
    bgColors: Record<string, string>,
    mode: "truecolor" | "256color",
    options?: { name?: string; sourcePath?: string }
  ) => unknown;
}

export interface PiAgentSessionResult {
  session: PiSession;
  extensionsResult: {
    extensions: unknown[];
    errors: unknown[];
  };
  modelFallbackMessage?: string;
}

export async function loadPiSdkBindings(nodeVersion: string = process.versions.node): Promise<PiSdkBindings> {
  assertNodeSupportsPiCoach(nodeVersion);

  return (await import(PI_CODING_AGENT_PACKAGE)) as unknown as PiSdkBindings;
}
