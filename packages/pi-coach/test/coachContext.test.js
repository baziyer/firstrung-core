import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCoachContext, buildCoachPrompt } from "../dist/index.js";

describe("coach context", () => {
  it("excludes raw source, diffs, prompts, responses, command output, logs, secrets, and env values by default", () => {
    const context = buildCoachContext({
      scanSummary: fakeSummary(),
      ruleResults: [
        {
          id: "result_1",
          ruleId: "rule_1",
          projectId: "project_demo",
          evaluatedAt: "2026-01-02T03:04:05.000Z",
          matched: true,
          confidence: "high",
          matchedSignalIds: ["signal_1"],
          attribution: { kind: "candidate_contributed", confidence: "high", basis: ["test"] },
          feedback: {
            summary: "Evidence summary",
            missingEvidence: ["No verification receipt yet."],
            nextStep: "Run a focused check."
          }
        }
      ],
      skillEpisodes: [],
      evidenceSignals: [
        {
          id: "signal_1",
          projectId: "project_demo",
          source: "git",
          signalType: "file.changed",
          observedAt: "2026-01-02T03:04:05.000Z",
          summary: "Changed metadata only.",
          sourceEventIds: ["event_1"],
          attribution: { kind: "candidate_contributed", confidence: "high", basis: ["test"] },
          confidence: "high",
          data: {
            rawSource: "RAW_SOURCE_SENTINEL",
            diff: "RAW_DIFF_SENTINEL",
            env: "SECRET_ENV_SENTINEL",
            absolutePath: "/Users/private/work/demo/src/example.ts",
            safeValue: "metadata",
            note: "INNOCUOUS_KEY_SECRET_SENTINEL"
          }
        }
      ],
      aiSessionEvents: [
        {
          id: "event_ai_1",
          projectId: "project_demo",
          sourceAdapter: "test",
          observedAt: "2026-01-02T03:04:05.000Z",
          sessionId: "session_1",
          type: "model.response.summarized",
          summary: "Summarized response only.",
          attribution: { kind: "agent_activity", confidence: "medium", basis: ["test"] },
          rawPromptIncluded: false,
          rawResponseIncluded: false,
          rawCommandOutputIncluded: false,
          rawSourceIncluded: false,
          rawDiffIncluded: false,
          redactionLevel: "none",
          metadata: {
            eventCategory: "summary"
          }
        }
      ],
      aiSessionSignals: [
        {
          id: "signal_ai_1",
          projectId: "project_demo",
          source: "ai_session",
          signalType: "ai_session.model.response.summarized",
          observedAt: "2026-01-02T03:04:05.000Z",
          summary: "AI session signal with unsafe metadata-shaped data.",
          sourceEventIds: ["event_ai_signal_1"],
          attribution: { kind: "agent_activity", confidence: "medium", basis: ["test"] },
          confidence: "medium",
          data: {
            prompt: "RAW_PROMPT_SENTINEL",
            response: "RAW_RESPONSE_SENTINEL",
            commandOutput: "RAW_COMMAND_OUTPUT_SENTINEL",
            privateLog: "PRIVATE_LOG_SENTINEL"
          }
        }
      ],
      candidateReflection: {
        summary: "I verified the change.",
        rawResponse: "RAW_REFLECTION_SENTINEL"
      }
    });

    const serialized = JSON.stringify(context);
    assert.equal(serialized.includes("RAW_SOURCE_SENTINEL"), false);
    assert.equal(serialized.includes("RAW_DIFF_SENTINEL"), false);
    assert.equal(serialized.includes("RAW_PROMPT_SENTINEL"), false);
    assert.equal(serialized.includes("RAW_RESPONSE_SENTINEL"), false);
    assert.equal(serialized.includes("RAW_COMMAND_OUTPUT_SENTINEL"), false);
    assert.equal(serialized.includes("PRIVATE_LOG_SENTINEL"), false);
    assert.equal(serialized.includes("SECRET_ENV_SENTINEL"), false);
    assert.equal(serialized.includes("RAW_REFLECTION_SENTINEL"), false);
    assert.equal(context.disclosure.rawSnippetConsent, false);
    assert.equal(context.disclosure.rawDataDisclosure, "none");
    assert.match(context.disclosure.notice, /configured model provider/i);
    assert.match(context.disclosure.notice, /raw source, diffs/i);
    assert.equal(context.summary.projectName, "local-project");
    assert.equal(context.summary.requestedPath, "project://root");
    assert.equal(context.summary.repoRoot, "project://root");
    assert.equal(serialized.includes("/Users/private/work/demo"), false);
    assert.equal(context.evidence.signals[0].data, undefined);
    assert.equal(serialized.includes("INNOCUOUS_KEY_SECRET_SENTINEL"), false);
    assert.match(context.disclosure.provider.pathHandling, /Repository-relative evidence paths may be sent/);
  });

  it("includes only explicit selected snippet metadata when consent is provided", () => {
    const context = buildCoachContext({
      scanSummary: fakeSummary(),
      ruleResults: [],
      skillEpisodes: [],
      evidenceSignals: [],
      selectedSnippetConsent: {
        approvedSnippetIds: ["snippet_1"],
        snippets: [
          {
            id: "snippet_1",
            label: "Candidate-selected test excerpt",
            text: "SELECTED_SNIPPET_SENTINEL"
          }
        ]
      }
    });

    assert.equal(context.disclosure.rawSnippetConsent, true);
    assert.equal(context.disclosure.rawDataDisclosure, "selected");
    assert.equal(JSON.stringify(context).includes("SELECTED_SNIPPET_SENTINEL"), false);
    assert.deepEqual(context.selectedSnippets, [
      {
        id: "snippet_1",
        label: "Candidate-selected test excerpt",
        textMetadata: {
          included: false,
          summary: "selected snippet text available only through explicit read tool consent",
          characterCount: "SELECTED_SNIPPET_SENTINEL".length
        }
      }
    ]);
  });

  it("uses session-local aliases across the provider context and prompt", () => {
    const summary = {
      ...fakeSummary(),
      projectId: "project_secret-repository",
      projectName: "secret-repository",
      requestedPath: "/Users/alice/work/secret-repository",
      repoRoot: "/Users/alice/work/secret-repository",
      currentBranch: "feature/customer-secret",
      targetRef: "refs/heads/feature/customer-secret",
      targetCommit: "0123456789abcdef0123456789abcdef01234567",
      baselineRef: "origin/private-baseline",
      attributionReason:
        "Compared origin/private-baseline to refs/heads/feature/customer-secret at 0123456789abcdef0123456789abcdef01234567."
    };
    const context = buildCoachContext({
      scanSummary: summary,
      ruleResults: [
        {
          id: "result_project_secret-repository",
          ruleId: "rule_private",
          projectId: "project_secret-repository",
          evaluatedAt: "2026-01-02T03:04:05.000Z",
          matched: true,
          confidence: "medium",
          matchedSignalIds: ["signal_project_secret-repository"],
          attribution: {
            kind: "change_window",
            confidence: "medium",
            basis: ["feature/customer-secret after origin/private-baseline"]
          },
          feedback: {
            summary: "Observed secret-repository metadata at 0123456789abcdef0123456789abcdef01234567.",
            missingEvidence: [],
            nextStep: "Verify the feature/customer-secret change."
          }
        }
      ],
      skillEpisodes: [],
      evidenceSignals: []
    });
    const providerPacket = `${JSON.stringify(context)}\n${buildCoachPrompt(context)}`;

    for (const sentinel of [
      "secret-repository",
      "/Users/alice/work/secret-repository",
      "feature/customer-secret",
      "refs/heads/feature/customer-secret",
      "0123456789abcdef0123456789abcdef01234567",
      "origin/private-baseline"
    ]) {
      assert.equal(providerPacket.includes(sentinel), false, sentinel);
    }
    assert.equal(context.summary.projectId, "project_local");
    assert.equal(context.summary.currentBranch, "branch-redacted");
    assert.equal(context.summary.targetCommit, "commit-redacted");
  });

  it("pseudonymizes selected snippet ids and absolute POSIX and Windows labels", () => {
    const context = buildCoachContext({
      scanSummary: fakeSummary(),
      ruleResults: [],
      skillEpisodes: [],
      selectedSnippetConsent: {
        approvedSnippetIds: ["/Users/alice/work/private.ts", "C:\\Users\\Alice\\work\\private.ts"],
        snippets: [
          { id: "/Users/alice/work/private.ts", label: "/Users/alice/work/private.ts", text: "POSIX_SENTINEL" },
          {
            id: "C:\\Users\\Alice\\work\\private.ts",
            label: "C:\\Users\\Alice\\work\\private.ts",
            text: "WINDOWS_SENTINEL"
          }
        ]
      }
    });
    const serialized = JSON.stringify(context);

    assert.deepEqual(
      context.selectedSnippets.map(({ id, label }) => ({ id, label })),
      [
        { id: "snippet_1", label: "Selected snippet 1" },
        { id: "snippet_2", label: "Selected snippet 2" }
      ]
    );
    assert.equal(serialized.includes("/Users/alice"), false);
    assert.equal(serialized.includes("C:\\Users\\Alice"), false);
    assert.equal(serialized.includes("POSIX_SENTINEL"), false);
    assert.equal(serialized.includes("WINDOWS_SENTINEL"), false);
  });

  it("excludes raw content-shaped approved file metadata by default", () => {
    const context = buildCoachContext({
      scanSummary: fakeSummary(),
      ruleResults: [],
      skillEpisodes: [],
      evidenceSignals: [],
      approvedFiles: [
        {
          path: "src/example.ts",
          label: "approved file metadata",
          content: "APPROVED_CONTENT_SENTINEL",
          text: "APPROVED_TEXT_SENTINEL",
          body: "APPROVED_BODY_SENTINEL",
          source: "APPROVED_SOURCE_SENTINEL",
          sourceText: "APPROVED_SOURCE_TEXT_SENTINEL",
          rawSource: "APPROVED_RAW_SOURCE_SENTINEL",
          diff: "APPROVED_DIFF_SENTINEL",
          safeMetadata: "path-only"
        }
      ]
    });

    const serialized = JSON.stringify(context);
    assert.equal(serialized.includes("APPROVED_CONTENT_SENTINEL"), false);
    assert.equal(serialized.includes("APPROVED_TEXT_SENTINEL"), false);
    assert.equal(serialized.includes("APPROVED_BODY_SENTINEL"), false);
    assert.equal(serialized.includes("APPROVED_SOURCE_SENTINEL"), false);
    assert.equal(serialized.includes("APPROVED_SOURCE_TEXT_SENTINEL"), false);
    assert.equal(serialized.includes("APPROVED_RAW_SOURCE_SENTINEL"), false);
    assert.equal(serialized.includes("APPROVED_DIFF_SENTINEL"), false);
    assert.equal(serialized.includes("path-only"), false);
    assert.deepEqual(context.approvedFiles, [
      { id: "approved_file_1", path: "src/example.ts", label: "approved file metadata" }
    ]);
    assert.equal(context.selectedSnippets, undefined);
  });

  it("drops innocuous unknown keys and pseudonymizes actors, usernames, remotes, and URLs", () => {
    const context = buildCoachContext({
      scanSummary: fakeSummary(),
      ruleResults: [
        {
          id: "result_private",
          ruleId: "rule_private",
          projectId: "project_demo",
          evaluatedAt: "2026-01-02T03:04:05.000Z",
          matched: true,
          confidence: "medium",
          matchedSignalIds: ["signal_private"],
          attribution: {
            kind: "change_window",
            confidence: "medium",
            actor: "private-user",
            basis: ["Reviewed alice@example.com at https://private.example/repo and git@github.com:private/repo.git"]
          },
          feedback: {
            summary: "See ssh://private.example/repo for the result.",
            missingEvidence: [],
            nextStep: "Ask private-user to verify."
          },
          note: "RULE_INNOCUOUS_SECRET"
        }
      ],
      skillEpisodes: [
        {
          id: "episode_private",
          projectId: "project_demo",
          type: "verification",
          title: "Private episode",
          status: "candidate",
          evidenceTier: ["observed"],
          confidence: "medium",
          supportingSignalIds: [],
          attribution: { kind: "unknown", confidence: "low", basis: ["unknown"] },
          username: "PRIVATE_USERNAME_SENTINEL"
        }
      ],
      evidenceSignals: [],
      approvedFiles: [{ path: "README.md", label: "README", note: "APPROVED_FILE_INNOCUOUS_SECRET" }],
      candidateReflection: {
        summary: "Checked https://private.example/profile",
        metadata: { note: "REFLECTION_INNOCUOUS_SECRET" }
      }
    });
    const serialized = `${JSON.stringify(context)}\n${buildCoachPrompt(context)}`;

    for (const sentinel of [
      "private-user",
      "alice@example.com",
      "https://private.example",
      "git@github.com",
      "ssh://private.example",
      "RULE_INNOCUOUS_SECRET",
      "PRIVATE_USERNAME_SENTINEL",
      "APPROVED_FILE_INNOCUOUS_SECRET",
      "REFLECTION_INNOCUOUS_SECRET"
    ]) {
      assert.equal(serialized.includes(sentinel), false, sentinel);
    }
    assert.equal(context.rules[0].attribution.actor, "actor-redacted");
    assert.match(serialized, /remote:\/\/redacted/);
  });

  it("requires distinct per-snippet consent before exposing snippet metadata", () => {
    const context = buildCoachContext({
      scanSummary: fakeSummary(),
      ruleResults: [],
      skillEpisodes: [],
      selectedSnippetConsent: {
        approvedSnippetIds: [],
        snippets: [{ id: "snippet_private", label: "Private", text: "UNCONSENTED_SNIPPET_SENTINEL" }]
      }
    });

    assert.equal(context.disclosure.rawSnippetConsent, false);
    assert.equal(context.selectedSnippets, undefined);
    assert.equal(JSON.stringify(context).includes("UNCONSENTED_SNIPPET_SENTINEL"), false);
  });
});

function fakeSummary() {
  return {
    projectId: "project_demo",
    projectName: "demo",
    requestedPath: "/repo",
    repoRoot: "/repo",
    currentBranch: "main",
    targetRef: "HEAD",
    targetCommit: "abc123",
    attributionMode: "working_tree",
    attributionReason: "test fixture",
    changedFileCount: 1,
    trackedFileCount: 3,
    rawContentIncluded: false
  };
}
