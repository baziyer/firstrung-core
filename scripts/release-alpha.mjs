#!/usr/bin/env node

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectRegistryPackage,
  inspectReleasePackages,
  runReleasePreflight
} from "./release-preflight.mjs";

const MINIMUM_RELEASE_NODE = "22.19.0";
const RELEASE_TAGS = ["alpha", "latest"];

export async function runAlphaRelease(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const runCommand = options.runCommand ?? execute;
  const log = options.log ?? (() => {});
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)));
  const runSourcePreflight = options.runSourcePreflight ?? runReleasePreflight;

  assertReleaseRuntime(options.nodeVersion ?? process.versions.node);
  log("Verify clean source, live upstream, workspace graph, and npm release state");
  const sourceResult = await runSourcePreflight({ cwd, runCommand });

  log("Verify npm identity and firstrung organisation publish role");
  const identityResult = await mustRun(runCommand, "npm", ["whoami"], cwd);
  const username = identityResult.stdout.trim();

  if (!username) {
    throw new Error("npm whoami returned no authenticated username.");
  }

  const orgResult = await mustRun(runCommand, "npm", ["org", "ls", "firstrung", "--json"], cwd);
  const role = readOrganisationRole(orgResult.stdout, username);

  if (!new Set(["owner", "admin", "developer"]).has(role)) {
    throw new Error(`npm user ${username} does not have a recognised firstrung publish role; found ${role ?? "none"}.`);
  }

  log("Run the complete CI-equivalent check and deterministic evaluation");
  await mustRun(runCommand, "npm", ["run", "check:ci"], cwd);
  log("Inspect every npm package payload");
  await mustRun(runCommand, "npm", ["run", "pack:dry-run"], cwd);

  if (options.preflightOnly) {
    return { ...sourceResult, username, role, published: [], resumed: [], preflightOnly: true };
  }

  const orderedPackages = orderReleasePackages(sourceResult.packages);
  const stateByName = new Map(sourceResult.packageStates.map((state) => [state.name, state]));
  const version = assertCoordinatedVersion(orderedPackages);
  const stagingTag = releaseStagingTag(version);
  const published = [];
  const resumed = [];

  for (const item of orderedPackages) {
    const state = stateByName.get(item.name);

    if (!state) {
      throw new Error(`Release preflight did not return registry state for ${item.name}; refusing to publish.`);
    }

    if (state.status === "published") {
      resumed.push(item.name);
      log(`Resume ${item.name}@${item.version}; registry metadata already matches ${sourceResult.source.head}`);
      continue;
    }

    if (state.status !== "missing") {
      throw new Error(`Release preflight returned unsupported state ${state.status} for ${item.name}.`);
    }

    log(`Publish ${item.name}@${item.version} behind staging tag ${stagingTag}`);
    await mustRun(
      runCommand,
      "npm",
      ["publish", "--workspace", item.workspace, "--access", "public", "--tag", stagingTag],
      cwd
    );
    await waitForPublishedMatch({
      cwd,
      head: sourceResult.source.head,
      item,
      runCommand,
      sleep,
      attempts: options.registryAttempts ?? 6,
      delayMilliseconds: options.registryDelayMilliseconds ?? 2_000
    });
    published.push(item.name);
  }

  log("Verify all package versions and immutable metadata before changing public tags");
  const verifiedStates = await inspectReleasePackages(cwd, sourceResult.source.head, orderedPackages, runCommand);
  const stillMissing = verifiedStates.filter(({ status }) => status !== "published");

  if (stillMissing.length > 0) {
    throw new Error(
      `Registry verification is incomplete for ${stillMissing.map(({ name }) => name).join(", ")}; public tags were not changed.`
    );
  }

  log(`Promote ${version} to alpha and latest only after the complete package set is verified`);
  await promoteReleaseTags({ cwd, packages: orderedPackages, runCommand });

  return {
    ...sourceResult,
    username,
    role,
    version,
    stagingTag,
    published,
    resumed,
    preflightOnly: false
  };
}

export function assertReleaseRuntime(actualVersion, minimumVersion = MINIMUM_RELEASE_NODE) {
  if (compareVersions(actualVersion, minimumVersion) < 0) {
    throw new Error(
      `FirstRung release tooling requires Node >=${minimumVersion}; current runtime is ${actualVersion}. Use the repository release runtime before continuing.`
    );
  }
}

export function orderReleasePackages(packages) {
  const names = new Set(packages.map(({ name }) => name));
  const emitted = new Set();
  const remaining = [...packages];
  const ordered = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((item) =>
      Object.keys(item.internalDependencies).filter((name) => names.has(name)).every((name) => emitted.has(name))
    );

    if (index === -1) {
      throw new Error(`Release package graph contains a dependency cycle: ${remaining.map(({ name }) => name).join(", ")}.`);
    }

    const [item] = remaining.splice(index, 1);
    ordered.push(item);
    emitted.add(item.name);
  }

  return ordered;
}

export function releaseStagingTag(version) {
  const safeVersion = version.replace(/[^A-Za-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "");

  if (!safeVersion) {
    throw new Error(`Cannot derive an npm staging tag from version ${version}.`);
  }

  return `release-${safeVersion}`;
}

export async function promoteReleaseTags({ cwd, packages, runCommand = execute }) {
  const snapshots = new Map();

  for (const item of packages) {
    snapshots.set(item.name, await readDistTags(cwd, item.name, runCommand));
  }

  const changed = [];

  try {
    for (const item of packages) {
      const previous = snapshots.get(item.name);

      for (const tag of RELEASE_TAGS) {
        if (previous[tag] === item.version) continue;
        changed.push({ item, tag });
        await mustRun(runCommand, "npm", ["dist-tag", "add", `${item.name}@${item.version}`, tag], cwd);
      }
    }

    for (const item of packages) {
      const tags = await readDistTags(cwd, item.name, runCommand);

      for (const tag of RELEASE_TAGS) {
        if (tags[tag] !== item.version) {
          throw new Error(
            `npm dist-tag verification failed for ${item.name}: ${tag} points to ${tags[tag] ?? "nothing"}, not ${item.version}.`
          );
        }
      }
    }
  } catch (error) {
    const rollbackFailures = await rollbackTags({ cwd, changed, snapshots, runCommand });
    const cause = error instanceof Error ? error.message : String(error);

    if (rollbackFailures.length > 0) {
      throw new Error(
        `${cause}\nTag promotion failed and rollback was incomplete: ${rollbackFailures.join("; ")}. Inspect npm dist-tags before retrying.`
      );
    }

    throw new Error(`${cause}\nTag promotion failed; the previous alpha/latest tag state was restored.`);
  }
}

async function rollbackTags({ cwd, changed, snapshots, runCommand }) {
  const failures = [];

  for (const { item, tag } of [...changed].reverse()) {
    const previousVersion = snapshots.get(item.name)[tag];
    let currentTags;

    try {
      currentTags = await readDistTags(cwd, item.name, runCommand);
    } catch {
      failures.push(`${item.name} ${tag} (state unreadable)`);
      continue;
    }

    if (currentTags[tag] === previousVersion || (!previousVersion && !(tag in currentTags))) continue;

    const args = previousVersion
      ? ["dist-tag", "add", `${item.name}@${previousVersion}`, tag]
      : ["dist-tag", "rm", item.name, tag];
    const result = await runCommand("npm", args, { cwd });

    if (result.exitCode !== 0) {
      failures.push(`${item.name} ${tag}`);
    }
  }

  return failures;
}

async function waitForPublishedMatch({
  cwd,
  head,
  item,
  runCommand,
  sleep,
  attempts,
  delayMilliseconds
}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const state = await inspectRegistryPackage(cwd, head, item, runCommand);

    if (state.status === "published") return;
    if (attempt < attempts) await sleep(delayMilliseconds);
  }

  throw new Error(
    `npm accepted ${item.name}@${item.version}, but matching registry metadata did not become visible after ${attempts} checks; public tags were not changed.`
  );
}

async function readDistTags(cwd, name, runCommand) {
  const result = await mustRun(runCommand, "npm", ["view", name, "dist-tags", "--json"], cwd);
  let tags;

  try {
    tags = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm returned invalid dist-tag metadata for ${name}.`);
  }

  if (!tags || typeof tags !== "object" || Array.isArray(tags)) {
    throw new Error(`npm returned invalid dist-tag metadata for ${name}.`);
  }

  for (const [tag, version] of Object.entries(tags)) {
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`npm returned an invalid ${tag} dist-tag for ${name}.`);
    }
  }

  return tags;
}

function readOrganisationRole(stdout, username) {
  let value;

  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("npm org ls firstrung returned invalid JSON.");
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value[username] === "string") return value[username];
    if (Array.isArray(value.objects)) {
      return value.objects.find((entry) => entry?.user?.name === username)?.role;
    }
  }

  return undefined;
}

function assertCoordinatedVersion(packages) {
  const versions = new Set(packages.map(({ version }) => version));

  if (versions.size !== 1) {
    throw new Error(`Alpha release requires one coordinated version; found ${[...versions].join(", ")}.`);
  }

  return packages[0].version;
}

function compareVersions(left, right) {
  const parse = (value) => value.split(".").map((part) => Number.parseInt(part, 10));
  const leftParts = parse(left);
  const rightParts = parse(right);

  if (
    leftParts.length < 3 ||
    rightParts.length < 3 ||
    [...leftParts, ...rightParts].some((part) => !Number.isInteger(part))
  ) {
    throw new Error(`Cannot compare Node versions ${left} and ${right}.`);
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }

  return 0;
}

async function mustRun(runCommand, command, args, cwd) {
  const result = await runCommand(command, args, { cwd });

  if (result.exitCode !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    throw new Error(`Release command failed: ${command} ${args.join(" ")}\n${detail}`);
  }

  return result;
}

function execute(command, args, options) {
  return new Promise((resolveResult) => {
    execFile(command, args, { cwd: options.cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
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
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--preflight-only");

  if (unknownArguments.length > 0) {
    process.stderr.write(`Unknown release argument(s): ${unknownArguments.join(", ")}\n`);
    process.exitCode = 1;
  } else {
    try {
      const preflightOnly = process.argv.includes("--preflight-only");
      const result = await runAlphaRelease({
        preflightOnly,
        log: (message) => process.stdout.write(`==> ${message}\n`)
      });

      if (preflightOnly) {
        process.stdout.write(
          `Release preflight passed for ${result.source.head}; no packages or dist-tags were changed.\n`
        );
      } else {
        process.stdout.write(
          `Published or resumed all ${result.packages.length} packages at ${result.version}; alpha and latest now point to this release.\n`
        );
        process.stdout.write(
          `Git was not tagged. After final verification, run: git tag -a v${result.version} -m "FirstRung ${result.version}" && git push origin v${result.version}\n`
        );
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
