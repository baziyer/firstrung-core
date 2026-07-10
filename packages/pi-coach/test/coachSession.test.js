import assert from "node:assert/strict";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { FIRSTRUNG_PI_COACH_TOOL_NAMES, runCoachSession } from "../dist/index.js";

describe("coach session", () => {
  it("dry-runs context without loading Pi", async () => {
    let loadedPi = false;
    const result = await runCoachSession({
      repoPath: "/repo",
      dryRunContext: true,
      now: fixedNow,
      scanModel: fakeScanModel(),
      loadPiSdkBindings: async () => {
        loadedPi = true;
        throw new Error("Pi should not load in dry-run mode");
      }
    });

    assert.equal(loadedPi, false);
    assert.equal(result.mode, "dry-run-context");
    assert.equal(result.context.summary.projectId, "project_local");
    assert.equal(result.sessionEvents.length, 0);
    assert.equal(result.feedback, undefined);
  });

  it("omits selected snippet text from dry-run session context", async () => {
    const result = await runCoachSession({
      repoPath: "/repo",
      dryRunContext: true,
      now: fixedNow,
      scanModel: fakeScanModel(),
      coachToolOptions: {
        approvedSnippetIds: ["snippet_dry"],
        selectedSnippets: [
          {
            id: "snippet_dry",
            label: "Candidate selected excerpt",
            text: "SELECTED_SNIPPET_DRY_RUN_SENTINEL"
          }
        ]
      }
    });

    assert.equal(JSON.stringify(result.context).includes("SELECTED_SNIPPET_DRY_RUN_SENTINEL"), false);
    assert.deepEqual(result.context.selectedSnippets, [
      {
        id: "snippet_1",
        label: "Candidate selected excerpt",
        textMetadata: {
          included: false,
          summary: "selected snippet text available only through explicit read tool consent",
          characterCount: "SELECTED_SNIPPET_DRY_RUN_SENTINEL".length
        }
      }
    ]);
  });

  it("uses a fake runtime and writes only coach artifacts under the output directory", async () => {
    const repo = join(tmpdir(), `firstrung-coach-session-${Date.now()}`);
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, "project.txt"), "before\n");

    const result = await runCoachSession({
      repoPath: repo,
      outDir: join(repo, ".firstrung", "coach"),
      now: fixedNow,
      sessionId: "session_test",
      scanModel: fakeScanModel(repo),
      piRuntime: {
        feedback: validFeedback(),
        streamEvents: [{ type: "model.response.summarized", raw: "RAW_STREAM_SENTINEL" }]
      }
    });

    assert.equal(result.mode, "fake-runtime");
    assert.match(result.feedback, /Metadata-only evidence was observed\./);
    assert.equal(await readFile(join(repo, "project.txt"), "utf8"), "before\n");

    const feedback = await readFile(join(repo, ".firstrung", "coach", "coach-feedback.md"), "utf8");
    const artifact = JSON.parse(await readFile(join(repo, ".firstrung", "coach", "coach-artifact.json"), "utf8"));
    const log = await readFile(join(repo, ".firstrung", "coach", "sessions", "session_test.jsonl"), "utf8");

    assert.equal(feedback, result.feedback);
    assert.equal(artifact.sessionId, "session_test");
    assert.equal(artifact.prompt, undefined);
    assert.equal(artifact.promptMetadata.included, false);
    assert.equal(typeof artifact.promptMetadata.characterCount, "number");
    assert.equal(log.includes("RAW_STREAM_SENTINEL"), false);
    await assert.rejects(() => access(join(repo, "coach-feedback.md")));
  });

  it("does not persist full prompt text in coach artifacts", async () => {
    const repo = join(tmpdir(), `firstrung-coach-prompt-${Date.now()}`);
    await mkdir(repo, { recursive: true });

    const result = await runCoachSession({
      repoPath: repo,
      outDir: join(repo, ".firstrung", "coach"),
      now: fixedNow,
      sessionId: "session_prompt",
      scanModel: fakeScanModel(repo, {
        signals: [
          {
            id: "signal_prompt",
            projectId: "project_demo",
            source: "git",
            signalType: "file.changed",
            observedAt: "2026-01-02T03:04:05.000Z",
            summary: "Changed metadata only.",
            sourceEventIds: ["event_1"],
            attribution: { kind: "candidate_contributed", confidence: "high", basis: ["test"] },
            confidence: "high",
            data: {
              rawSource: "RAW_PROMPT_ARTIFACT_SENTINEL",
              note: "INNOCUOUS_ARTIFACT_SECRET_SENTINEL"
            }
          }
        ]
      }),
      piRuntime: {
        feedback: validFeedback()
      }
    });
    const artifactText = await readFile(join(repo, ".firstrung", "coach", "coach-artifact.json"), "utf8");
    const artifact = JSON.parse(artifactText);

    assert.equal(result.prompt.includes("You are the FirstRung Coach"), true);
    assert.equal(artifactText.includes("You are the FirstRung Coach"), false);
    assert.equal(artifactText.includes("RAW_PROMPT_ARTIFACT_SENTINEL"), false);
    assert.equal(artifactText.includes("INNOCUOUS_ARTIFACT_SECRET_SENTINEL"), false);
    assert.deepEqual(Object.keys(artifact.promptMetadata).sort(), ["characterCount", "included", "summary"]);
  });

  it("omits selected snippet text from persisted coach artifacts", async () => {
    const repo = join(tmpdir(), `firstrung-coach-snippet-${Date.now()}`);
    await mkdir(repo, { recursive: true });

    await runCoachSession({
      repoPath: repo,
      outDir: join(repo, ".firstrung", "coach"),
      now: fixedNow,
      sessionId: "session_snippet",
      scanModel: fakeScanModel(repo),
      coachToolOptions: {
        approvedSnippetIds: ["snippet_selected"],
        selectedSnippets: [
          {
            id: "snippet_selected",
            label: "Candidate selected excerpt",
            text: "SELECTED_SNIPPET_ARTIFACT_SENTINEL"
          }
        ]
      },
      piRuntime: {
        feedback: validFeedback()
      }
    });

    const artifactText = await readFile(join(repo, ".firstrung", "coach", "coach-artifact.json"), "utf8");
    const artifact = JSON.parse(artifactText);

    assert.equal(artifactText.includes("SELECTED_SNIPPET_ARTIFACT_SENTINEL"), false);
    assert.deepEqual(artifact.context.selectedSnippets, [
      {
        id: "snippet_1",
        label: "Candidate selected excerpt",
        textMetadata: {
          included: false,
          summary: "selected snippet text available only through explicit read tool consent",
          characterCount: "SELECTED_SNIPPET_ARTIFACT_SENTINEL".length
        }
      }
    ]);
  });

  it("rejects unsafe output paths and session ids", async () => {
    const repo = join(tmpdir(), `firstrung-coach-paths-${Date.now()}`);
    await mkdir(repo, { recursive: true });

    await assert.rejects(
      () =>
        runCoachSession({
          repoPath: repo,
          outDir: join(repo, "src"),
          now: fixedNow,
          scanModel: fakeScanModel(repo),
          piRuntime: { feedback: validFeedback() }
        }),
      /FirstRung Coach outDir must be under the repository \.firstrung\/coach directory\./
    );

    await assert.rejects(
      () =>
        runCoachSession({
          repoPath: repo,
          now: fixedNow,
          sessionId: "../escape",
          scanModel: fakeScanModel(repo),
          piRuntime: { feedback: validFeedback() }
        }),
      /FirstRung Coach sessionId must contain only letters, numbers, underscores, and hyphens\./
    );
  });

  it("fails live Pi mode early when no model credential is available", async () => {
    let createdSession = false;

    await assert.rejects(
      () =>
        runCoachSession({
          repoPath: "/repo",
          now: fixedNow,
          confirmProviderDisclosure: true,
          scanModel: fakeScanModel(),
          loadPiSdkBindings: async () => ({
            AuthStorage: {
              inMemory: () => ({
                hasAuth: () => false
              })
            },
            ModelRegistry: {
              inMemory: () => ({})
            },
            SessionManager: {
              inMemory: () => ({})
            },
            SettingsManager: {
              inMemory: () => ({})
            },
            createExtensionRuntime: () => ({}),
            defineTool: (tool) => tool,
            Theme: class {},
            createAgentSession: async () => {
              createdSession = true;
              throw new Error("createAgentSession should not be called without credentials");
            }
          })
        }),
      /No Pi\/model credential is available for firstrung-coach\. Run pi login or configure a supported model credential, then retry\./
    );

    assert.equal(createdSession, false);
  });

  it("requires a second exact provider/model confirmation before prompting", async () => {
    const repo = join(tmpdir(), `firstrung-coach-provider-target-${Date.now()}`);
    await mkdir(repo, { recursive: true });
    let prompted = false;
    let disposed = false;
    let disclosedTarget;
    const session = {
      model: { provider: "test-provider", id: "model/exact-v1" },
      getActiveToolNames: () => [...FIRSTRUNG_PI_COACH_TOOL_NAMES],
      getAllTools: () => FIRSTRUNG_PI_COACH_TOOL_NAMES.map((name) => ({ name })),
      prompt: async () => {
        prompted = true;
      },
      dispose: () => {
        disposed = true;
      }
    };

    await assert.rejects(
      () =>
        runCoachSession({
          repoPath: repo,
          now: fixedNow,
          scanModel: fakeScanModel(repo),
          confirmProviderDisclosure: true,
          onProviderPreflight: (preflight) => {
            disclosedTarget = preflight.target;
          },
          loadPiSdkBindings: async () => fakeBindings(session)
        }),
      /exact provider\/model target.*Confirm target test-provider\/model\/exact-v1/s
    );

    assert.equal(disclosedTarget, "test-provider/model/exact-v1");
    assert.equal(prompted, false);
    assert.equal(disposed, true);
  });

  it("wires injected live Pi with created auth, locked tools, and awaited stream logging", async () => {
    const repo = join(tmpdir(), `firstrung-coach-live-${Date.now()}`);
    await mkdir(repo, { recursive: true });
    const calls = {
      createAuth: 0,
      inMemoryAuth: 0,
      createAgentOptions: undefined,
      verifyCommand: undefined,
      providerPreflight: undefined
    };
    const session = {
      model: { provider: "test-provider", id: "test-model" },
      getActiveToolNames: () => [...FIRSTRUNG_PI_COACH_TOOL_NAMES],
      getAllTools: () => FIRSTRUNG_PI_COACH_TOOL_NAMES.map((name) => ({ name })),
      subscribe: (listener) => {
        session.listener = listener;
        return () => {
          session.unsubscribed = true;
        };
      },
      prompt: async () => {
        session.listener?.({
          type: "message_end",
          raw: "LIVE_RAW_STREAM_SENTINEL",
          assistantMessageEvent: { type: "text_delta", delta: "LIVE_ASSISTANT_DELTA_SENTINEL" },
          result: { content: [{ type: "text", text: "LIVE_RESULT_TEXT_SENTINEL" }] },
          message: {
            role: "assistant",
            stopReason: "stop",
            content: [{ type: "text", text: validFeedback("Live evidence from the provider.") }]
          },
          safe: "live-safe-event"
        });
      }
    };

    const result = await runCoachSession({
      repoPath: repo,
      outDir: join(repo, ".firstrung", "coach"),
      now: fixedNow,
      sessionId: "session_live",
      confirmProviderDisclosure: true,
      confirmProviderTarget: () => true,
      onProviderPreflight: (preflight) => {
        calls.providerPreflight = preflight;
      },
      scanModel: fakeScanModel(repo),
      coachToolOptions: {
        approvedSnippetIds: ["snippet_test"],
        approvedCommandIds: ["npm_test"],
        commandRunner: async (command, args, options) => {
          calls.verifyCommand = { command, args, options };
          return {
            exitCode: 0,
            stdout: "RAW_VERIFY_STDOUT_SENTINEL",
            stderr: ""
          };
        },
        approvedFiles: [
          {
            path: "README.md",
            label: "README metadata",
            content: "RAW_PROJECT_FILE_SENTINEL"
          }
        ],
        selectedSnippets: [
          {
            id: "snippet_test",
            label: "README selected note",
            text: "SELECTED_SNIPPET_TEXT"
          },
          {
            id: "snippet_unconsented",
            label: "Private note",
            text: "UNCONSENTED_SNIPPET_TEXT_SENTINEL"
          }
        ]
      },
      loadPiSdkBindings: async () => ({
        AuthStorage: {
          create: () => {
            calls.createAuth += 1;
            return { hasAuth: () => true };
          },
          inMemory: () => {
            calls.inMemoryAuth += 1;
            return { hasAuth: () => false };
          }
        },
        ModelRegistry: {
          inMemory: () => ({})
        },
        SessionManager: {
          inMemory: () => ({})
        },
        SettingsManager: {
          inMemory: () => ({})
        },
        createExtensionRuntime: () => ({}),
        defineTool: (tool) => ({ ...tool, defined: true }),
        Theme: class {},
        createAgentSession: async (options) => {
          calls.createAgentOptions = options;
          return {
            session,
            extensionsResult: { extensions: [], errors: [] }
          };
        }
      })
    });

    assert.equal(result.mode, "live-pi");
    assert.match(result.feedback, /Live evidence from the provider\./);
    assert.deepEqual(result.provider, { provider: "test-provider", model: "test-model" });
    assert.equal(calls.providerPreflight.provider, "test-provider");
    assert.equal(calls.providerPreflight.target, "test-provider/test-model");
    assert.deepEqual(calls.providerPreflight.selectedSnippetIds, ["snippet_1"]);
    assert.equal(calls.createAuth, 1);
    assert.equal(calls.inMemoryAuth, 0);
    assert.deepEqual(calls.createAgentOptions.tools, [...FIRSTRUNG_PI_COACH_TOOL_NAMES]);
    assert.equal(calls.createAgentOptions.noTools, "all");
    assert.deepEqual(
      calls.createAgentOptions.customTools.map((tool) => tool.name).sort(),
      [...FIRSTRUNG_PI_COACH_TOOL_NAMES].sort()
    );
    assert.equal(calls.createAgentOptions.customTools.every((tool) => tool.defined === true), true);
    assert.equal(session.unsubscribed, true);

    const verifyTool = calls.createAgentOptions.customTools.find((tool) => tool.name === "firstrung_verify");
    const searchTool = calls.createAgentOptions.customTools.find((tool) => tool.name === "firstrung_search_approved_files");
    const readTool = calls.createAgentOptions.customTools.find((tool) => tool.name === "firstrung_read_approved_file");
    const writeArtifactTool = calls.createAgentOptions.customTools.find(
      (tool) => tool.name === "firstrung_write_coach_artifact"
    );

    assert.equal(typeof verifyTool.execute, "function");
    assert.equal(typeof searchTool.execute, "function");
    assert.equal(typeof readTool.execute, "function");
    assert.equal(writeArtifactTool, undefined);

    const verifyResult = await verifyTool.execute("tool_1", { commandId: "npm_test" });
    assert.equal(verifyResult.details.exitCode, 0);
    assert.equal(verifyResult.details.rawCommandOutputIncluded, false);
    assert.equal(verifyResult.content[0].text.includes("npm_test completed with exit code 0"), true);
    assert.deepEqual(calls.verifyCommand, {
      command: "npm",
      args: ["test"],
      options: { cwd: repo, timeoutMs: undefined }
    });

    const searchResult = await searchTool.execute("tool_2", { query: "README" });
    assert.equal(searchResult.content[0].text.includes("README.md"), true);
    assert.equal(searchResult.content[0].text.includes("RAW_PROJECT_FILE_SENTINEL"), false);

    const readResult = await readTool.execute("tool_3", { id: "snippet_1" });
    assert.equal(readResult.content[0].text.includes("SELECTED_SNIPPET_TEXT"), true);
    assert.equal(readResult.content[0].text.includes("RAW_PROJECT_FILE_SENTINEL"), false);
    assert.equal(readResult.details.rawContentIncluded, undefined);
    assert.equal(readResult.details.rawDataDisclosure, "selected");
    assert.equal(readResult.details.rawSnippetConsent, true);
    const deniedSnippet = await readTool.execute("tool_4", { id: "snippet_2" });
    assert.equal(deniedSnippet.details.denied, true);
    assert.equal(deniedSnippet.content[0].text.includes("UNCONSENTED_SNIPPET_TEXT_SENTINEL"), false);
    const unconsentedSearch = await searchTool.execute("tool_5", { query: "UNCONSENTED_SNIPPET_TEXT_SENTINEL" });
    assert.equal(unconsentedSearch.content[0].text.includes("UNCONSENTED_SNIPPET_TEXT_SENTINEL"), false);
    await assert.rejects(() => access(join(repo, ".firstrung", "coach", "SELECTED_SNIPPET_TEXT.json")));

    const log = await readFile(join(repo, ".firstrung", "coach", "sessions", "session_live.jsonl"), "utf8");
    assert.equal(log.includes('"type":"message_end"'), true);
    assert.equal(log.includes('"assistantEventType":"text_delta"'), true);
    assert.equal(log.includes("live-safe-event"), false);
    assert.equal(log.includes("LIVE_RAW_STREAM_SENTINEL"), false);
    assert.equal(log.includes("LIVE_ASSISTANT_DELTA_SENTINEL"), false);
    assert.equal(log.includes("LIVE_RESULT_TEXT_SENTINEL"), false);
  });

  it("fails safely without writing feedback when the provider response violates the contract", async () => {
    const repo = join(tmpdir(), `firstrung-coach-invalid-feedback-${Date.now()}`);
    await mkdir(repo, { recursive: true });

    await assert.rejects(
      () =>
        runCoachSession({
          repoPath: repo,
          now: fixedNow,
          scanModel: fakeScanModel(repo),
          piRuntime: { feedback: "A vague unstructured answer." }
        }),
      /did not return usable feedback/
    );
    await assert.rejects(() => access(join(repo, ".firstrung", "coach", "coach-feedback.md")));
  });

  it("refuses an output directory reached through a symbolic link", async () => {
    const repo = join(tmpdir(), `firstrung-coach-symlink-${Date.now()}`);
    const outside = join(tmpdir(), `firstrung-coach-outside-${Date.now()}`);
    await mkdir(join(repo, ".firstrung"), { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(repo, ".firstrung", "coach"));

    await assert.rejects(
      () =>
        runCoachSession({
          repoPath: repo,
          now: fixedNow,
          scanModel: fakeScanModel(repo),
          piRuntime: { feedback: validFeedback() }
        }),
      /refused an output path containing a symbolic link/
    );
    await assert.rejects(() => access(join(outside, "coach-feedback.md")));
  });

  it("refuses symbolic links at every FirstRung-owned output file", async () => {
    for (const target of ["coach-feedback.md", "coach-artifact.json", "sessions/session_link.jsonl"]) {
      const suffix = target.replaceAll("/", "-");
      const repo = join(tmpdir(), `firstrung-coach-file-symlink-${suffix}-${Date.now()}`);
      const outDir = join(repo, ".firstrung", "coach");
      const outsideFile = join(tmpdir(), `firstrung-coach-file-outside-${suffix}-${Date.now()}.txt`);
      const targetPath = join(outDir, target);
      await mkdir(join(outDir, "sessions"), { recursive: true });
      await writeFile(outsideFile, "OUTSIDE_FILE_SENTINEL\n");
      await symlink(outsideFile, targetPath);

      await assert.rejects(
        () =>
          runCoachSession({
            repoPath: repo,
            outDir,
            now: fixedNow,
            sessionId: "session_link",
            scanModel: fakeScanModel(repo),
            piRuntime: {
              feedback: validFeedback(),
              ...(target.startsWith("sessions/") ? { streamEvents: [{ type: "safe-event" }] } : {})
            }
          }),
        /refused an output file that is a symbolic link/
      );
      assert.equal(await readFile(outsideFile, "utf8"), "OUTSIDE_FILE_SENTINEL\n");
    }
  });
});

function fakeScanModel(repoRoot = "/repo", overrides = {}) {
  const summary = {
    projectId: "project_demo",
    projectName: "demo",
    requestedPath: repoRoot,
    repoRoot,
    currentBranch: "main",
    targetRef: "HEAD",
    targetCommit: "abc123",
    attributionMode: "working_tree",
    attributionReason: "test fixture",
    changedFileCount: 1,
    trackedFileCount: 2,
    rawContentIncluded: false
  };

  return {
    summary,
    signals: [
      {
        id: "signal_1",
        projectId: "project_demo",
        source: "git",
        signalType: "file.changed",
        observedAt: "2026-01-02T03:04:05.000Z",
        summary: "Changed metadata only.",
        sourceEventIds: ["event_1"],
        attribution: { kind: "candidate_contributed", confidence: "high", basis: ["test"] },
        confidence: "high"
      }
    ],
    ...overrides
  };
}

function fixedNow() {
  return new Date("2026-01-02T03:04:05.000Z");
}

function validFeedback(evidence = "Metadata-only evidence was observed.") {
  return `## Evidence\n${evidence}\n\n## Inference\nThe evidence supports a narrow, provisional inference.\n\n## Next steps\nRun one focused verification check.`;
}

function fakeBindings(session) {
  return {
    AuthStorage: { create: () => ({ hasAuth: () => true }), inMemory: () => ({ hasAuth: () => true }) },
    ModelRegistry: { inMemory: () => ({}) },
    SessionManager: { inMemory: () => ({}) },
    SettingsManager: { inMemory: () => ({}) },
    createExtensionRuntime: () => ({}),
    defineTool: (tool) => tool,
    Theme: class {},
    createAgentSession: async () => ({ session, extensionsResult: { extensions: [], errors: [] } })
  };
}
