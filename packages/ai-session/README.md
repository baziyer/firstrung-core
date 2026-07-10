# @firstrung/ai-session

Source-neutral AI session events for FirstRung evidence signals. The package
keeps adapter names as data, so a local adapter can identify itself without
adding runtime-specific dependencies.

```ts
import {
  aiSessionEventsToEvidenceSignals,
  parseAiSessionEvent
} from "@firstrung/ai-session";

const event = parseAiSessionEvent({
  id: "event_verification_completed",
  projectId: "project_checkout_app",
  sourceAdapter: "local-coach",
  observedAt: "2026-07-06T09:15:00Z",
  sessionId: "session_123",
  type: "verification.command.completed",
  summary: "A summarized verification command completed successfully.",
  redactionLevel: "redacted",
  attribution: {
    kind: "agent_activity",
    confidence: "high",
    basis: ["local session summary"]
  }
});

const signals = aiSessionEventsToEvidenceSignals([event]);
```

Disclosure booleans default to `false` when omitted:

- `rawPromptIncluded`
- `rawResponseIncluded`
- `rawCommandOutputIncluded`
- `rawSourceIncluded`
- `rawDiffIncluded`

`redactionLevel` defaults to `none`. Use `redacted` or `selected` only when the
event intentionally includes summarized or selected raw-data context.
