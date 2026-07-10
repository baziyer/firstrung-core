import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { runReleasePreflight } from "./release-preflight.mjs";

describe("release preflight", () => {
  it("accepts clean, remotely published source with missing package versions", async () => {
    const cwd = await fixture();
    const calls = [];
    const result = await runReleasePreflight({ cwd, runCommand: successfulRunner(calls) });

    assert.equal(result.source.head, HEAD);
    assert.deepEqual(result.packages.map(({ name }) => name), ["@firstrung/example", "firstrung"]);
    assert.equal(result.packages[1].outputContract.outputContract, "terminal-brief-v1");
    assert.deepEqual(result.packageStates.map(({ status }) => status), ["missing", "missing"]);
    assert.equal(calls.filter(({ command }) => command === "npm").length, 2);
  });

  it("refuses a dirty tree before contacting npm", async () => {
    const cwd = await fixture();
    const calls = [];
    const runner = successfulRunner(calls, { status: " M README.md\n" });

    await assert.rejects(() => runReleasePreflight({ cwd, runCommand: runner }), /refuses a dirty working tree/);
    assert.equal(calls.some(({ command }) => command === "npm"), false);
  });

  it("refuses a local commit that is not the remote branch head", async () => {
    const cwd = await fixture();
    const runner = successfulRunner([], { remoteHead: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });

    await assert.rejects(() => runReleasePreflight({ cwd, runCommand: runner }), /refuses unpushed or divergent source/);
  });

  it("allows an interrupted release to resume only when existing package metadata matches HEAD", async () => {
    const cwd = await fixture();
    const runner = successfulRunner([], {
      published: new Map([
        ["@firstrung/example@1.2.3", registryMetadata("@firstrung/example")],
        ["firstrung@1.2.3", registryMetadata("firstrung")]
      ])
    });
    const result = await runReleasePreflight({ cwd, runCommand: runner });

    assert.deepEqual(result.packageStates.map(({ status }) => status), ["published", "published"]);
    assert.deepEqual(result.packageStates.map(({ gitHead }) => gitHead), [HEAD, HEAD]);
  });

  it("refuses to resume an existing version from another commit", async () => {
    const cwd = await fixture();
    const metadata = registryMetadata("@firstrung/example");
    metadata.gitHead = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const runner = successfulRunner([], {
      published: new Map([["@firstrung/example@1.2.3", metadata]])
    });

    await assert.rejects(() => runReleasePreflight({ cwd, runCommand: runner }), /not release HEAD.*refusing to resume/);
  });

  it("refuses to resume a CLI version whose output contract differs", async () => {
    const cwd = await fixture();
    const metadata = registryMetadata("firstrung");
    metadata.firstrung.rendererVersion = "stale";
    const runner = successfulRunner([], {
      published: new Map([["firstrung@1.2.3", metadata]])
    });

    await assert.rejects(() => runReleasePreflight({ cwd, runCommand: runner }), /mismatched firstrung output contract/);
  });

  it("fails closed when npm availability cannot be verified", async () => {
    const cwd = await fixture();
    const runner = successfulRunner([], { registryFailure: true });

    await assert.rejects(() => runReleasePreflight({ cwd, runCommand: runner }), /could not inspect .*npm view failed safely/);
  });

  it("requires static CLI output-contract metadata", async () => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, "packages", "cli", "package.json"),
      JSON.stringify({ name: "firstrung", version: "1.2.3", files: ["LICENSE"] })
    );

    await assert.rejects(
      () => runReleasePreflight({ cwd, runCommand: successfulRunner([]) }),
      /must expose static `firstrung` output-contract metadata/
    );
  });

  it("requires every publishable package to ship the exact Apache-2.0 license", async () => {
    const cwd = await fixture();
    await writeFile(join(cwd, "packages", "cli", "LICENSE"), "not the repository license\n");

    await assert.rejects(
      () => runReleasePreflight({ cwd, runCommand: successfulRunner([]) }),
      /packages\/cli LICENSE must exactly match the repository Apache-2\.0 license/
    );
  });

  it("refuses a stale internal workspace dependency", async () => {
    const cwd = await fixture();
    const cliPath = join(cwd, "packages", "cli", "package.json");
    const cliManifest = JSON.parse(await readFile(cliPath, "utf8"));
    cliManifest.dependencies["@firstrung/example"] = "1.2.2";
    await writeFile(cliPath, JSON.stringify(cliManifest));

    await assert.rejects(
      () => runReleasePreflight({ cwd, runCommand: successfulRunner([]) }),
      /firstrung declares @firstrung\/example@1\.2\.2, but the workspace release version is 1\.2\.3/
    );
  });

  it("requires one coordinated workspace version set", async () => {
    const cwd = await fixture();
    await writeFile(
      join(cwd, "packages", "example", "package.json"),
      JSON.stringify({ name: "@firstrung/example", version: "1.2.4", files: ["LICENSE"] })
    );

    await assert.rejects(
      () => runReleasePreflight({ cwd, runCommand: successfulRunner([]) }),
      /requires one coordinated workspace version.*1\.2\.4, 1\.2\.3/
    );
  });
});

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_LICENSE = "Apache License\nVersion 2.0, January 2004\n";

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "firstrung-release-preflight-"));
  await mkdir(join(cwd, "packages", "example"), { recursive: true });
  await mkdir(join(cwd, "packages", "cli"), { recursive: true });
  await writeFile(join(cwd, "LICENSE"), TEST_LICENSE);
  await writeFile(join(cwd, "packages", "example", "LICENSE"), TEST_LICENSE);
  await writeFile(join(cwd, "packages", "cli", "LICENSE"), TEST_LICENSE);
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, workspaces: ["packages/example", "packages/cli"] })
  );
  await writeFile(
    join(cwd, "packages", "example", "package.json"),
    JSON.stringify({ name: "@firstrung/example", version: "1.2.3", files: ["LICENSE"] })
  );
  await writeFile(
    join(cwd, "packages", "cli", "package.json"),
    JSON.stringify({
      name: "firstrung",
      version: "1.2.3",
      files: ["LICENSE"],
      dependencies: {
        "@firstrung/example": "1.2.3"
      },
      firstrung: {
        outputContract: "terminal-brief-v1",
        scanSchemaVersion: "firstrung.scan.v1",
        feedbackPacketSchemaVersion: "firstrung.feedback.v1",
        rulesetVersion: "2026-07-10.1",
        templateVersion: "2026-07-10.1",
        rendererVersion: "2026-07-10.1",
        defaultMaxNonblankLines: 5,
        defaultTargetMaxWords: 65
      }
    })
  );
  return cwd;
}

function successfulRunner(calls, options = {}) {
  return async (command, args) => {
    calls.push({ command, args });

    if (command === "git") {
      const key = args.slice(0, 2).join(" ");
      if (key === "status --porcelain=v1") return ok(options.status ?? "");
      if (key === "symbolic-ref --quiet") return ok("main\n");
      if (key === "config --get" && args[2] === "branch.main.remote") return ok("origin\n");
      if (key === "config --get" && args[2] === "branch.main.merge") return ok("refs/heads/main\n");
      if (key === "rev-parse HEAD") return ok(`${HEAD}\n`);
      if (key === "ls-remote --exit-code") return ok(`${options.remoteHead ?? HEAD}\trefs/heads/main\n`);
    }

    if (command === "npm") {
      const spec = args[1];
      if (options.registryFailure) return fail("npm error code EAI_AGAIN");
      if (options.published?.has(spec)) return ok(`${JSON.stringify(options.published.get(spec))}\n`);
      return fail(`npm error code E404\nnpm error 404 Not Found - GET registry - ${spec}`);
    }

    return fail(`Unexpected command: ${command} ${args.join(" ")}`);
  };
}

function registryMetadata(name) {
  return {
    name,
    version: "1.2.3",
    gitHead: HEAD,
    dependencies: name === "firstrung" ? { "@firstrung/example": "1.2.3" } : {},
    ...(name === "firstrung"
      ? {
          firstrung: {
            outputContract: "terminal-brief-v1",
            scanSchemaVersion: "firstrung.scan.v1",
            feedbackPacketSchemaVersion: "firstrung.feedback.v1",
            rulesetVersion: "2026-07-10.1",
            templateVersion: "2026-07-10.1",
            rendererVersion: "2026-07-10.1",
            defaultMaxNonblankLines: 5,
            defaultTargetMaxWords: 65
          }
        }
      : {})
  };
}

function ok(stdout) {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr) {
  return { exitCode: 1, stdout: "", stderr };
}
