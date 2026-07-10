#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runReleasePreflight(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runCommand = options.runCommand ?? execute;
  const readText = options.readText ?? ((path) => readFile(path, "utf8"));

  await assertCleanSource(cwd, runCommand);
  const source = await assertHeadIsPublishedToUpstream(cwd, runCommand);
  const packages = await loadReleasePackages(cwd, readText);
  const packageStates = await inspectReleasePackages(cwd, source.head, packages, runCommand);

  return { source, packages, packageStates };
}

export async function loadReleasePackages(cwd, readText = (path) => readFile(path, "utf8")) {
  const rootManifest = JSON.parse(await readText(resolve(cwd, "package.json")));
  let rootLicense;

  try {
    rootLicense = await readText(resolve(cwd, "LICENSE"));
  } catch {
    throw new Error("Release preflight requires a repository-root LICENSE file.");
  }

  if (!Array.isArray(rootManifest.workspaces) || rootManifest.workspaces.length === 0) {
    throw new Error("Release preflight requires an explicit root workspaces array.");
  }

  const packages = [];

  for (const workspace of rootManifest.workspaces) {
    if (typeof workspace !== "string" || workspace.includes("*")) {
      throw new Error("Release preflight supports explicit workspace paths only; wildcard workspaces are not release-safe.");
    }

    const manifest = JSON.parse(await readText(resolve(cwd, workspace, "package.json")));

    if (manifest.private === true) continue;
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw new Error(`Publishable workspace ${workspace} must declare string name and version fields.`);
    }

    if (!Array.isArray(manifest.files) || !manifest.files.includes("LICENSE")) {
      throw new Error(`Publishable workspace ${workspace} must include LICENSE in its package files list.`);
    }

    let packageLicense;

    try {
      packageLicense = await readText(resolve(cwd, workspace, "LICENSE"));
    } catch {
      throw new Error(`Publishable workspace ${workspace} is missing its package-local LICENSE file.`);
    }

    if (packageLicense !== rootLicense) {
      throw new Error(`Publishable workspace ${workspace} LICENSE must exactly match the repository Apache-2.0 license.`);
    }

    packages.push({
      workspace,
      name: manifest.name,
      version: manifest.version,
      internalDependencies: collectInternalDependencies(manifest),
      ...(manifest.name === "firstrung" ? { outputContract: validateCliOutputContract(manifest.firstrung) } : {})
    });
  }

  const duplicateNames = packages.filter((item, index) => packages.findIndex((candidate) => candidate.name === item.name) !== index);

  if (duplicateNames.length > 0) {
    throw new Error(`Release preflight found duplicate package names: ${duplicateNames.map((item) => item.name).join(", ")}.`);
  }

  const versions = new Set(packages.map((item) => item.version));

  if (versions.size !== 1) {
    throw new Error(
      `Release preflight requires one coordinated workspace version for release:alpha; found ${[...versions].join(", ")}.`
    );
  }

  const packageVersions = new Map(packages.map((item) => [item.name, item.version]));

  for (const item of packages) {
    for (const [dependency, declaredVersion] of Object.entries(item.internalDependencies)) {
      const workspaceVersion = packageVersions.get(dependency);

      if (!workspaceVersion) {
        throw new Error(`${item.name} declares internal dependency ${dependency}, but no publishable workspace owns it.`);
      }

      if (declaredVersion !== workspaceVersion) {
        throw new Error(
          `${item.name} declares ${dependency}@${declaredVersion}, but the workspace release version is ${workspaceVersion}. Align the internal dependency graph before publishing.`
        );
      }
    }
  }

  return packages;
}

function collectInternalDependencies(manifest) {
  const dependencies = {};

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (name.startsWith("@firstrung/")) {
        dependencies[name] = version;
      }
    }
  }

  return dependencies;
}

function validateCliOutputContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The firstrung CLI manifest must expose static `firstrung` output-contract metadata.");
  }

  const stringFields = [
    "outputContract",
    "scanSchemaVersion",
    "feedbackPacketSchemaVersion",
    "rulesetVersion",
    "templateVersion",
    "rendererVersion"
  ];
  const integerFields = ["defaultMaxNonblankLines", "defaultTargetMaxWords"];

  for (const field of stringFields) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      throw new Error(`The firstrung CLI output-contract field ${field} must be a non-empty string.`);
    }
  }

  for (const field of integerFields) {
    if (!Number.isInteger(value[field]) || value[field] <= 0) {
      throw new Error(`The firstrung CLI output-contract field ${field} must be a positive integer.`);
    }
  }

  return Object.fromEntries([...stringFields, ...integerFields].map((field) => [field, value[field]]));
}

async function assertCleanSource(cwd, runCommand) {
  const status = await mustRun(runCommand, "git", ["status", "--porcelain=v1", "--untracked-files=all"], cwd);

  if (status.stdout.trim().length > 0) {
    const changed = status.stdout.trim().split("\n").slice(0, 12).join("\n");
    throw new Error(`Release preflight refuses a dirty working tree. Commit or remove every change first:\n${changed}`);
  }
}

async function assertHeadIsPublishedToUpstream(cwd, runCommand) {
  const branch = (await mustRun(runCommand, "git", ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd)).stdout.trim();
  const remote = (await mustRun(runCommand, "git", ["config", "--get", `branch.${branch}.remote`], cwd)).stdout.trim();
  const mergeRef = (await mustRun(runCommand, "git", ["config", "--get", `branch.${branch}.merge`], cwd)).stdout.trim();
  const head = (await mustRun(runCommand, "git", ["rev-parse", "HEAD"], cwd)).stdout.trim();

  if (!branch || !remote || remote === "." || !mergeRef || !head) {
    throw new Error("Release preflight requires a checked-out branch with a remote upstream.");
  }

  const remoteResult = await mustRun(runCommand, "git", ["ls-remote", "--exit-code", remote, mergeRef], cwd);
  const remoteHead = remoteResult.stdout.trim().split(/\s+/u)[0];

  if (!remoteHead || remoteHead !== head) {
    throw new Error(
      `Release preflight refuses unpushed or divergent source. Local HEAD ${head} does not match ${remote}/${mergeRef} (${remoteHead || "missing"}).`
    );
  }

  return { branch, remote, mergeRef, head };
}

export async function inspectReleasePackages(cwd, head, packages, runCommand = execute) {
  const states = [];

  for (const item of packages) {
    states.push(await inspectRegistryPackage(cwd, head, item, runCommand));
  }

  return states;
}

export async function inspectRegistryPackage(cwd, head, item, runCommand = execute) {
  const spec = `${item.name}@${item.version}`;
  const result = await runCommand(
    "npm",
    ["view", spec, "name", "version", "gitHead", "dependencies", "firstrung", "--json"],
    { cwd }
  );

  if (result.exitCode !== 0) {
    const failure = `${result.stderr}\n${result.stdout}`;

    if (/(?:E404|404\s+Not Found|is not in this registry)/iu.test(failure)) {
      return { name: item.name, version: item.version, status: "missing" };
    }

    throw new Error(`Release preflight could not inspect ${spec}. npm view failed safely:\n${failure.trim()}`);
  }

  let metadata;

  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    throw new Error(`Release preflight received invalid registry metadata for ${spec}.`);
  }

  assertPublishedPackageMatches(item, head, metadata);

  return {
    name: item.name,
    version: item.version,
    status: "published",
    gitHead: metadata.gitHead
  };
}

export function assertPublishedPackageMatches(item, head, metadata) {
  const spec = `${item.name}@${item.version}`;

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`Registry metadata for ${spec} must be a JSON object.`);
  }

  if (metadata.name !== item.name || metadata.version !== item.version) {
    throw new Error(
      `Registry metadata for ${spec} does not identify the requested package and version; refusing to resume.`
    );
  }

  if (metadata.gitHead !== head) {
    throw new Error(
      `Registry metadata for ${spec} points to gitHead ${metadata.gitHead ?? "missing"}, not release HEAD ${head}; refusing to resume.`
    );
  }

  const expectedDependencies = sortedEntries(item.internalDependencies);
  const actualDependencies = sortedEntries(
    Object.fromEntries(
      Object.entries(metadata.dependencies ?? {}).filter(([name]) => name.startsWith("@firstrung/"))
    )
  );

  if (JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) {
    throw new Error(`Registry metadata for ${spec} has mismatched internal @firstrung dependency pins; refusing to resume.`);
  }

  if (
    item.outputContract &&
    JSON.stringify(sortedEntries(metadata.firstrung ?? {})) !== JSON.stringify(sortedEntries(item.outputContract))
  ) {
    throw new Error(`Registry metadata for ${spec} has a mismatched firstrung output contract; refusing to resume.`);
  }
}

function sortedEntries(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

async function mustRun(runCommand, command, args, cwd) {
  const result = await runCommand(command, args, { cwd });

  if (result.exitCode !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(`Release preflight command failed: ${command} ${args.join(" ")}\n${detail}`);
  }

  return result;
}

function execute(command, args, options) {
  return new Promise((resolveResult) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolveResult({
        exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout: stdout ?? "",
        stderr: stderr ?? (error ? error.message : "")
      });
    });
  });
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    const result = await runReleasePreflight();
    const missing = result.packageStates.filter(({ status }) => status === "missing").length;
    const published = result.packageStates.length - missing;
    process.stdout.write(
      `Release source preflight passed for ${result.source.head}; ${missing} package versions are missing and ${published} already match this commit. No packages were published.\n`
    );
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
