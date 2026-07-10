const EMPTY_RUNTIME = Object.freeze({});

const APPEND_SYSTEM_PROMPT = Object.freeze([
  "Operate in a read-only FirstRung coach mode until an explicit future runner enables more capability.",
  "Use only FirstRung-approved tools and treat any other available tool as out of scope.",
  "Do not edit, write, delete, patch, or otherwise mutate files.",
  "Separate evidence, inference, and next steps clearly in every response."
]) as readonly string[];

const SYSTEM_PROMPT = [
  "You are the FirstRung Coach for local evidence review.",
  "Use only FirstRung-approved tools.",
  "do not edit, write, or delete files.",
  "Distinguish evidence, inference, and next steps."
].join(" ");

export interface FirstRungPiResourceLoaderOptions {
  createExtensionRuntime?: () => unknown;
}

export interface PiExtensionsResult {
  extensions: unknown[];
  errors: unknown[];
  runtime: unknown;
}

export interface PiSkillsResult {
  skills: unknown[];
  diagnostics: unknown[];
}

export interface PiPromptsResult {
  prompts: unknown[];
  diagnostics: unknown[];
}

export interface PiThemesResult {
  themes: unknown[];
  diagnostics: unknown[];
}

export interface PiAgentsFilesResult {
  agentsFiles: Array<{ path: string; content: string }>;
}

export class FirstRungPiResourceLoader {
  readonly #runtime: unknown;

  constructor(options: FirstRungPiResourceLoaderOptions = {}) {
    this.#runtime = options.createExtensionRuntime?.() ?? EMPTY_RUNTIME;
  }

  getExtensions(): PiExtensionsResult {
    return {
      extensions: [],
      errors: [],
      runtime: this.#runtime
    };
  }

  getSkills(): PiSkillsResult {
    return {
      skills: [],
      diagnostics: []
    };
  }

  getPrompts(): PiPromptsResult {
    return {
      prompts: [],
      diagnostics: []
    };
  }

  getThemes(): PiThemesResult {
    return {
      themes: [],
      diagnostics: []
    };
  }

  getAgentsFiles(): PiAgentsFilesResult {
    return {
      agentsFiles: []
    };
  }

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  getAppendSystemPrompt(): readonly string[] {
    return APPEND_SYSTEM_PROMPT;
  }

  extendResources(): void {
    return undefined;
  }

  async reload(): Promise<void> {
    return undefined;
  }
}
