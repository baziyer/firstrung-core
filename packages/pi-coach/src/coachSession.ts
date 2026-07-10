import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { collectRepository } from "@firstrung/collector";
import { runAlphaRules } from "@firstrung/rules";
import type { EvidenceSignal, RuleResult, ScanSummary, SkillEpisode } from "@firstrung/schema";

import { buildCoachContext, type CoachContext } from "./coachContext.js";
import { buildCoachPrompt } from "./coachPrompt.js";
import { buildFirstRungCustomTools, type FirstRungCoachToolOptions } from "./coachTools.js";
import { createWorkspaceEvidenceLogger } from "./evidenceLog.js";
import { FirstRungPiResourceLoader } from "./piResourceLoader.js";
import { assertSafeOwnedFilePath, ensureSafeOutputDirectory, writeSafeOwnedFile } from "./pathSafety.js";
import {
  loadPiSdkBindings as defaultLoadPiSdkBindings,
  type PiSdkBindings,
  type PiSessionStreamEvent
} from "./piSdk.js";
import { assertPiCoachToolRegistryMatchesProfile, FIRSTRUNG_PI_COACH_TOOL_NAMES } from "./toolProfile.js";

export interface CoachScanModel {
  summary: ScanSummary;
  signals: EvidenceSignal[];
  ruleResults?: RuleResult[];
  skillEpisodes?: SkillEpisode[];
}

export interface FakePiCoachRuntime {
  feedback: string;
  streamEvents?: readonly unknown[];
  activeToolNames?: readonly string[];
  registryVisibleToolNames?: readonly string[];
}

export interface RunCoachSessionOptions {
  repoPath: string;
  outDir?: string;
  since?: string;
  branch?: string;
  sessionDir?: string;
  sessionId?: string;
  dryRunContext?: boolean;
  now?: () => Date;
  scanModel?: CoachScanModel;
  piRuntime?: FakePiCoachRuntime;
  loadPiSdkBindings?: (nodeVersion?: string) => Promise<PiSdkBindings>;
  confirmProviderDisclosure?: boolean;
  onProviderPreflight?: (preflight: CoachProviderPreflight) => void | Promise<void>;
  confirmProviderTarget?: (preflight: CoachProviderPreflight) => boolean | Promise<boolean>;
  coachToolOptions?: Partial<Omit<FirstRungCoachToolOptions, "context" | "repoRoot" | "outDir" | "sessionId">>;
}

export interface CoachProviderPreflight {
  provider: string;
  model: string;
  target: string;
  outboundFields: string[];
  pathHandling: string;
  selectedSnippetIds: string[];
}

export interface RunCoachSessionResult {
  mode: "dry-run-context" | "fake-runtime" | "live-pi";
  sessionId: string;
  context: CoachContext;
  prompt: string;
  feedback?: string;
  artifactPath?: string;
  feedbackPath?: string;
  sessionLogPath?: string;
  sessionEvents: unknown[];
  provider?: {
    provider: string;
    model: string;
  };
}

export const COACH_PROVIDER_CONFIRMATION_ERROR =
  "Live FirstRung Coach sends a redacted prompt and approved tool results to your configured model provider. Review --dry-run-context, then re-run with --confirm-provider to consent.";
export const COACH_PROVIDER_TARGET_CONFIRMATION_ERROR =
  "FirstRung Coach resolved an exact provider/model target that has not been confirmed. No provider request was sent.";

const INVALID_COACH_FEEDBACK_ERROR =
  "FirstRung Coach did not return usable feedback, so no feedback artifact was written. Expected non-empty Evidence, Inference, and Next steps sections in that order, within 160 words.";
const MAX_COACH_FEEDBACK_WORDS = 160;
const MAX_COACH_FEEDBACK_CHARACTERS = 2_000;

export async function runCoachSession(options: RunCoachSessionOptions): Promise<RunCoachSessionResult> {
  const now = options.now ?? (() => new Date());
  const scanModel = await resolveScanModel(options, now);
  const ruleRun =
    scanModel.ruleResults && scanModel.skillEpisodes
      ? { ruleResults: scanModel.ruleResults, skillEpisodes: scanModel.skillEpisodes }
      : runAlphaRules({ projectId: scanModel.summary.projectId, signals: scanModel.signals, now: now() });
  const context = buildCoachContext({
    scanSummary: scanModel.summary,
    ruleResults: ruleRun.ruleResults,
    skillEpisodes: ruleRun.skillEpisodes,
    evidenceSignals: scanModel.signals,
    ...(options.coachToolOptions?.approvedFiles ? { approvedFiles: options.coachToolOptions.approvedFiles } : {}),
    ...(options.coachToolOptions?.selectedSnippets
      ? {
          selectedSnippetConsent: {
            snippets: options.coachToolOptions.selectedSnippets,
            approvedSnippetIds: options.coachToolOptions.approvedSnippetIds ?? []
          }
        }
      : {})
  });
  const sessionId = validateSessionId(options.sessionId ?? `session_${safeStamp(now())}`);
  const prompt = buildCoachPrompt(context);

  if (options.dryRunContext) {
    return {
      mode: "dry-run-context",
      sessionId,
      context,
      prompt,
      sessionEvents: []
    };
  }

  const repoRoot = scanModel.summary.repoRoot || resolve(options.repoPath);
  const outDir = resolveOutDir(repoRoot, options.outDir);
  const sessionDir = resolveSessionDir(repoRoot, outDir, options.sessionDir);
  const sessionEvents: unknown[] = [];

  if (options.piRuntime) {
    const feedback = validateCoachFeedback(options.piRuntime.feedback);
    assertPiCoachToolRegistryMatchesProfile({
      activeToolNames: options.piRuntime.activeToolNames ?? FIRSTRUNG_PI_COACH_TOOL_NAMES,
      registryVisibleToolNames: options.piRuntime.registryVisibleToolNames ?? FIRSTRUNG_PI_COACH_TOOL_NAMES
    });
    await prepareCoachOutputPaths(repoRoot, outDir, sessionDir);
    const logger = createWorkspaceEvidenceLogger({ repoPath: repoRoot, outDir, sessionDir, sessionId, now });

    for (const event of options.piRuntime.streamEvents ?? []) {
      sessionEvents.push(event);
      await logger.log(event);
    }

    const paths = await writeCoachArtifacts({
      outDir,
      sessionDir,
      sessionId,
      context,
      prompt,
      feedback,
      mode: "fake-runtime",
      repoRoot,
      ...optional({ sessionLogPath: logger.logPath })
    });

    return optional({
      mode: "fake-runtime",
      sessionId,
      context,
      prompt,
      feedback,
      artifactPath: paths.artifactPath,
      feedbackPath: paths.feedbackPath,
      sessionLogPath: logger.logPath,
      sessionEvents
    }) as RunCoachSessionResult;
  }

  if (!options.confirmProviderDisclosure) {
    throw new Error(COACH_PROVIDER_CONFIRMATION_ERROR);
  }

  const bindings = await (options.loadPiSdkBindings ?? defaultLoadPiSdkBindings)();
  const resourceLoader = new FirstRungPiResourceLoader({
    createExtensionRuntime: () => bindings.createExtensionRuntime()
  });
  const settingsManager = bindings.SettingsManager.inMemory({});
  const authStorage = bindings.AuthStorage.create?.() ?? bindings.AuthStorage.inMemory({});
  assertPiCredentialAvailable(authStorage);
  await prepareCoachOutputPaths(repoRoot, outDir, sessionDir);
  const sessionManager = bindings.SessionManager.inMemory(repoRoot);
  const modelRegistry = bindings.ModelRegistry.inMemory(authStorage);
  const customTools = buildFirstRungCustomTools(bindings, {
    context,
    repoRoot,
    outDir,
    sessionId,
    ...options.coachToolOptions
  });

  const agentResult = await mapCredentialErrors(() =>
    bindings.createAgentSession({
      cwd: repoRoot,
      resourceLoader,
      sessionManager,
      settingsManager,
      modelRegistry,
      authStorage,
      customTools,
      tools: [...FIRSTRUNG_PI_COACH_TOOL_NAMES],
      noTools: "all"
    })
  );
  const session = agentResult.session;
  assertPiCoachToolRegistryMatchesProfile({
    activeToolNames: session.getActiveToolNames(),
    registryVisibleToolNames: session.getAllTools().map((tool) => tool.name)
  });
  let provider: CoachProviderPreflight;

  try {
    provider = providerPreflight(session, context);
    await options.onProviderPreflight?.(provider);
  } catch (error) {
    await session.dispose?.();
    throw error;
  }

  if ((await options.confirmProviderTarget?.(provider)) !== true) {
    await session.dispose?.();
    throw new Error(
      `${COACH_PROVIDER_TARGET_CONFIRMATION_ERROR} Confirm target ${provider.target} and retry with --confirm-provider-target ${provider.target}.`
    );
  }

  const logger = createWorkspaceEvidenceLogger({ repoPath: repoRoot, outDir, sessionDir, sessionId, now });
  const pendingLogWrites: Promise<unknown>[] = [];
  let lastAssistantMessage: unknown;
  const unsubscribe = session.subscribe?.((event: PiSessionStreamEvent) => {
    sessionEvents.push(event);
    pendingLogWrites.push(logger.log(event));
    lastAssistantMessage = assistantMessageFromEvent(event) ?? lastAssistantMessage;
  });

  try {
    await session.prompt?.(prompt, {
      source: "extension",
      streamingBehavior: "followUp",
      metadata: {
        sessionId,
        projectId: context.summary.projectId,
        rawDataDisclosure: context.disclosure.rawDataDisclosure
      }
    });
  } finally {
    unsubscribe?.();
    await Promise.all(pendingLogWrites);
    await session.dispose?.();
  }

  const finalAssistantMessage = lastAssistantMessage ?? lastAssistantMessageFromState(session.state?.messages);
  const feedback = validateCoachFeedback(textFromAssistantMessage(finalAssistantMessage));
  const paths = await writeCoachArtifacts({
    repoRoot,
    outDir,
    sessionDir,
    sessionId,
    context,
    prompt,
    feedback,
    mode: "live-pi",
    provider: { provider: provider.provider, model: provider.model },
    ...optional({ sessionLogPath: logger.logPath })
  });

  return optional({
    mode: "live-pi",
    sessionId,
    context,
    prompt,
    feedback,
    artifactPath: paths.artifactPath,
    feedbackPath: paths.feedbackPath,
    sessionLogPath: logger.logPath,
    sessionEvents,
    provider: { provider: provider.provider, model: provider.model }
  }) as RunCoachSessionResult;
}

export function validateCoachFeedback(input: unknown): string {
  if (typeof input !== "string") {
    throw new Error(INVALID_COACH_FEEDBACK_ERROR);
  }

  const normalized = input.replaceAll("\r\n", "\n").trim();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_COACH_FEEDBACK_CHARACTERS ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)
  ) {
    throw new Error(INVALID_COACH_FEEDBACK_ERROR);
  }

  const headings = [
    ...normalized.matchAll(/^(?:#{1,6}[ \t]*)?(Evidence|Inference|Next steps)[ \t]*:?[ \t]*$/gimu)
  ];
  const expectedHeadings = ["evidence", "inference", "next steps"];

  if (
    headings.length !== expectedHeadings.length ||
    headings.some((heading, index) => heading[1]?.toLowerCase() !== expectedHeadings[index]) ||
    normalized.slice(0, headings[0]?.index ?? 0).trim().length > 0
  ) {
    throw new Error(INVALID_COACH_FEEDBACK_ERROR);
  }

  const sections = headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? normalized.length;
    return normalized.slice(start, end).trim();
  });

  if (sections.some((section) => section.length === 0) || countWords(normalized) > MAX_COACH_FEEDBACK_WORDS) {
    throw new Error(INVALID_COACH_FEEDBACK_ERROR);
  }

  return ["## Evidence", sections[0], "", "## Inference", sections[1], "", "## Next steps", sections[2]].join("\n");
}

async function prepareCoachOutputPaths(repoRoot: string, outDir: string, sessionDir: string): Promise<void> {
  await ensureSafeOutputDirectory(repoRoot, outDir);
  await ensureSafeOutputDirectory(repoRoot, sessionDir);
}

function providerPreflight(session: { model?: { provider?: string; id?: string; modelId?: string } }, context: CoachContext): CoachProviderPreflight {
  const provider = session.model?.provider;
  const model = session.model?.id ?? session.model?.modelId;

  if (
    !provider ||
    !model ||
    !/^[A-Za-z0-9._-]{1,80}$/u.test(provider) ||
    !/^[A-Za-z0-9._:/-]{1,200}$/u.test(model) ||
    model.includes("://")
  ) {
    throw new Error("FirstRung Coach could not determine the exact provider/model target, so no provider request was sent.");
  }

  return {
    provider,
    model,
    target: `${provider}/${model}`,
    outboundFields: [...context.disclosure.provider.promptFields, ...context.disclosure.provider.toolFields],
    pathHandling: context.disclosure.provider.pathHandling,
    selectedSnippetIds: context.selectedSnippets?.map((snippet) => snippet.id) ?? []
  };
}

function assistantMessageFromEvent(event: PiSessionStreamEvent): unknown {
  if ((event.type === "message_end" || event.type === "turn_end") && isAssistantMessage(event.message)) {
    return event.message;
  }

  if (event.type === "agent_end") {
    return lastAssistantMessageFromState(event.messages);
  }

  const terminalMessage: Record<string, unknown> | undefined = isRecord(event.assistantMessageEvent)
    ? (event.assistantMessageEvent as Record<string, unknown>)
    : undefined;

  if (terminalMessage?.type === "done" && isAssistantMessage(terminalMessage.message)) {
    return terminalMessage.message;
  }

  return undefined;
}

function lastAssistantMessageFromState(messages?: readonly unknown[]): unknown {
  return [...(messages ?? [])].reverse().find(isAssistantMessage);
}

function textFromAssistantMessage(message: unknown): string | undefined {
  if (!isAssistantMessage(message)) {
    return undefined;
  }

  if (typeof message.stopReason === "string" && message.stopReason !== "stop") {
    return undefined;
  }

  if (!Array.isArray(message.content)) {
    return undefined;
  }

  const text = message.content
    .filter((item): item is { type: "text"; text: string } => isRecord(item) && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function isAssistantMessage(value: unknown): value is Record<string, unknown> & { role: "assistant" } {
  return isRecord(value) && value.role === "assistant";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countWords(value: string): number {
  return value.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

async function resolveScanModel(options: RunCoachSessionOptions, now: () => Date): Promise<CoachScanModel> {
  if (options.scanModel) {
    return options.scanModel;
  }

  const collection = await collectRepository({
    repoPath: options.repoPath,
    now: now(),
    ...(options.since ? { since: options.since } : {}),
    ...(options.branch ? { branch: options.branch } : {})
  });

  return {
    summary: collection.summary,
    signals: collection.signals
  };
}

function resolveOutDir(repoRoot: string, outDir?: string): string {
  const allowedRoot = resolve(repoRoot, ".firstrung", "coach");

  if (!outDir) {
    return allowedRoot;
  }

  const resolved = isAbsolute(outDir) ? resolve(outDir) : resolve(repoRoot, outDir);

  if (!isWithinOrEqual(resolved, allowedRoot)) {
    throw new Error("FirstRung Coach outDir must be under the repository .firstrung/coach directory.");
  }

  return resolved;
}

function resolveSessionDir(repoRoot: string, outDir: string, sessionDir?: string): string {
  const defaultSessionDir = join(outDir, "sessions");

  if (!sessionDir) {
    return defaultSessionDir;
  }

  const resolved = isAbsolute(sessionDir) ? resolve(sessionDir) : resolve(repoRoot, sessionDir);
  const allowedRoots = [defaultSessionDir, join(repoRoot, ".firstrung", "coach", "sessions")].map((path) =>
    ensureTrailingSep(resolve(path))
  );
  const candidate = ensureTrailingSep(resolved);

  if (!allowedRoots.some((root) => candidate.startsWith(root))) {
    throw new Error(
      "FirstRung Coach sessionDir must be under the output directory sessions folder or the repository .firstrung/coach/sessions folder."
    );
  }

  return resolved;
}

async function writeCoachArtifacts(input: {
  repoRoot: string;
  outDir: string;
  sessionDir: string;
  sessionId: string;
  context: CoachContext;
  prompt: string;
  feedback: string;
  mode: "fake-runtime" | "live-pi";
  provider?: { provider: string; model: string };
  sessionLogPath?: string;
}): Promise<{ artifactPath: string; feedbackPath: string }> {
  await prepareCoachOutputPaths(input.repoRoot, input.outDir, input.sessionDir);
  const feedbackPath = join(input.outDir, "coach-feedback.md");
  const artifactPath = join(input.outDir, "coach-artifact.json");

  await assertSafeOwnedFilePath(input.repoRoot, feedbackPath);
  await assertSafeOwnedFilePath(input.repoRoot, artifactPath);
  await writeSafeOwnedFile(input.repoRoot, feedbackPath, input.feedback);
  await writeSafeOwnedFile(
    input.repoRoot,
    artifactPath,
    `${JSON.stringify(
      {
        sessionId: input.sessionId,
        mode: input.mode,
        context: coachArtifactContext(input.context),
        promptMetadata: {
          included: false,
          summary: "redacted coach prompt",
          characterCount: input.prompt.length
        },
        ...(input.provider ? { provider: input.provider } : {}),
        feedbackPath: relative(input.outDir, feedbackPath),
        ...(input.sessionLogPath ? { sessionLogPath: relative(input.outDir, input.sessionLogPath) } : {})
      },
      null,
      2
    )}\n`
  );

  return { artifactPath, feedbackPath };
}

function coachArtifactContext(context: CoachContext): Record<string, unknown> {
  return {
    ...context,
    ...(context.selectedSnippets ? { selectedSnippets: context.selectedSnippets.map((snippet) => ({ ...snippet })) } : {})
  };
}

function ensureTrailingSep(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`;
}

function isWithinOrEqual(path: string, allowedRoot: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedAllowedRoot = resolve(allowedRoot);
  return resolvedPath === resolvedAllowedRoot || ensureTrailingSep(resolvedPath).startsWith(ensureTrailingSep(resolvedAllowedRoot));
}

const PI_CREDENTIAL_ERROR =
  "No Pi/model credential is available for firstrung-coach. Run pi login or configure a supported model credential, then retry.";
const PI_AUTH_PROVIDERS = ["anthropic", "openai", "google", "bedrock", "azure", "ollama"] as const;

function assertPiCredentialAvailable(authStorage: { hasAuth?: (provider: string) => boolean }): void {
  if (typeof authStorage.hasAuth !== "function") {
    return;
  }

  if (!PI_AUTH_PROVIDERS.some((provider) => authStorage.hasAuth?.(provider))) {
    throw new Error(PI_CREDENTIAL_ERROR);
  }
}

async function mapCredentialErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/(auth|credential|login|api\s*key|apikey)/i.test(message)) {
      throw new Error(PI_CREDENTIAL_ERROR);
    }

    throw error;
  }
}

function validateSessionId(sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error("FirstRung Coach sessionId must contain only letters, numbers, underscores, and hyphens.");
  }

  return sessionId;
}

function safeStamp(date: Date): string {
  return date.toISOString().replace(/[^0-9A-Za-z]/g, "");
}

function optional<T extends Record<string, unknown>>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}
