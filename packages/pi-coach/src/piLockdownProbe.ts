import { buildCoachContext } from "./coachContext.js";
import { buildFirstRungCustomTools } from "./coachTools.js";
import { FirstRungPiResourceLoader } from "./piResourceLoader.js";
import { loadPiSdkBindings, type PiSdkBindings } from "./piSdk.js";
import { assertPiCoachToolRegistryMatchesProfile, FIRSTRUNG_PI_COACH_TOOL_NAMES } from "./toolProfile.js";

export interface PiLockdownProbeResult {
  sdkLoaded: true;
  networkRequestAttempted: false;
  resources: {
    extensions: 0;
    skills: 0;
    prompts: 0;
    themes: 0;
    agentsFiles: 0;
  };
  activeToolNames: string[];
  managersCreatedInMemory: true;
}

export async function runPiLockdownProbe(options: {
  loadBindings?: () => Promise<PiSdkBindings>;
} = {}): Promise<PiLockdownProbeResult> {
  const bindings = await (options.loadBindings ?? loadPiSdkBindings)();
  const resourceLoader = new FirstRungPiResourceLoader({
    createExtensionRuntime: () => bindings.createExtensionRuntime()
  });
  const authStorage = bindings.AuthStorage.inMemory({});
  bindings.ModelRegistry.inMemory(authStorage);
  bindings.SessionManager.inMemory("project://probe");
  bindings.SettingsManager.inMemory({});

  const context = buildCoachContext({
    scanSummary: {
      projectId: "project_probe",
      projectName: "probe",
      requestedPath: "/probe",
      repoRoot: "/probe",
      currentBranch: "probe",
      targetRef: "HEAD",
      targetCommit: "probe-commit",
      attributionMode: "unknown",
      attributionReason: "non-networked lockdown probe",
      changedFileCount: 0,
      trackedFileCount: 0,
      rawContentIncluded: false
    },
    ruleResults: [],
    skillEpisodes: [],
    evidenceSignals: []
  });
  const tools = buildFirstRungCustomTools(bindings, {
    context,
    repoRoot: "/probe",
    outDir: "/probe/.firstrung/coach",
    sessionId: "session_probe"
  });
  const activeToolNames = tools.map((tool) => tool.name);
  assertPiCoachToolRegistryMatchesProfile({
    activeToolNames,
    registryVisibleToolNames: activeToolNames
  });

  const extensions = resourceLoader.getExtensions();
  const skills = resourceLoader.getSkills();
  const prompts = resourceLoader.getPrompts();
  const themes = resourceLoader.getThemes();
  const agentsFiles = resourceLoader.getAgentsFiles();

  if (
    extensions.extensions.length !== 0 ||
    skills.skills.length !== 0 ||
    prompts.prompts.length !== 0 ||
    themes.themes.length !== 0 ||
    agentsFiles.agentsFiles.length !== 0
  ) {
    throw new Error("FirstRung Pi lockdown probe found an unexpected project or global resource.");
  }

  return {
    sdkLoaded: true,
    networkRequestAttempted: false,
    resources: { extensions: 0, skills: 0, prompts: 0, themes: 0, agentsFiles: 0 },
    activeToolNames: [...FIRSTRUNG_PI_COACH_TOOL_NAMES],
    managersCreatedInMemory: true
  };
}
