import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertReleaseRuntime,
  orderReleasePackages,
  promoteReleaseTags,
  releaseStagingTag,
  runAlphaRelease
} from "./release-alpha.mjs";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VERSION = "1.2.3-alpha.4";

describe("resumable alpha release", () => {
  it("runs one complete non-publishing preflight", async () => {
    const fixture = releaseFixture();
    const fake = registryRunner(fixture);
    const result = await runAlphaRelease({
      cwd: "/release",
      nodeVersion: "22.20.0",
      preflightOnly: true,
      runSourcePreflight: async () => fixture.preflight,
      runCommand: fake.run
    });

    assert.equal(result.preflightOnly, true);
    assert.equal(result.username, "baziyer");
    assert.equal(result.role, "owner");
    assert.deepEqual(
      fake.calls.filter(({ args }) => args[0] === "run").map(({ args }) => args.slice(0, 2)),
      [["run", "check:ci"], ["run", "pack:dry-run"]]
    );
    assert.equal(fake.calls.some(({ args }) => args[0] === "publish"), false);
    assert.equal(fake.calls.some(({ args }) => args[0] === "dist-tag"), false);
  });

  it("resumes matching packages, publishes missing packages in dependency order, then promotes tags", async () => {
    const fixture = releaseFixture({ publishedNames: new Set(["@firstrung/schema"]) });
    const fake = registryRunner(fixture);
    const result = await runAlphaRelease({
      cwd: "/release",
      nodeVersion: "22.20.0",
      runSourcePreflight: async () => fixture.preflight,
      runCommand: fake.run,
      sleep: async () => {},
      registryDelayMilliseconds: 0
    });

    assert.deepEqual(result.resumed, ["@firstrung/schema"]);
    assert.deepEqual(result.published, ["@firstrung/report", "firstrung"]);
    assert.equal(result.version, VERSION);
    assert.equal(result.stagingTag, "release-1-2-3-alpha-4");

    const publishCalls = fake.calls.filter(({ args }) => args[0] === "publish");
    assert.deepEqual(publishCalls.map(({ args }) => args[2]), ["packages/report", "packages/cli"]);
    assert.equal(publishCalls.every(({ args }) => args.at(-1) === result.stagingTag), true);

    const firstPromotion = fake.calls.findIndex(({ args }) => args[0] === "dist-tag" && args[1] === "add");
    const lastPublish = fake.calls.findLastIndex(({ args }) => args[0] === "publish");
    assert.ok(firstPromotion > lastPublish);

    for (const item of fixture.packages) {
      assert.equal(fake.tags.get(item.name).alpha, VERSION);
      assert.equal(fake.tags.get(item.name).latest, VERSION);
    }
    assert.equal(fake.tags.get("@firstrung/report")[result.stagingTag], VERSION);
    assert.equal(fake.tags.get("firstrung")[result.stagingTag], VERSION);
  });

  it("restores every prior public tag when promotion fails part-way", async () => {
    const fixture = releaseFixture({ publishedNames: new Set(["@firstrung/schema", "@firstrung/report", "firstrung"]) });
    const fake = registryRunner(fixture, {
      failOnce: ({ args }) => args.join(" ") === `dist-tag add @firstrung/report@${VERSION} alpha`
    });

    await assert.rejects(
      () => promoteReleaseTags({ cwd: "/release", packages: fixture.packages, runCommand: fake.run }),
      /previous alpha\/latest tag state was restored/
    );

    for (const item of fixture.packages) {
      assert.deepEqual(fake.tags.get(item.name), {
        alpha: "1.2.3-alpha.3",
        latest: "1.2.3-alpha.3"
      });
    }
  });

  it("stops before registry mutation when npm organisation role is insufficient", async () => {
    const fixture = releaseFixture();
    const fake = registryRunner(fixture, { role: "member" });

    await assert.rejects(
      () => runAlphaRelease({
        cwd: "/release",
        nodeVersion: "22.20.0",
        runSourcePreflight: async () => fixture.preflight,
        runCommand: fake.run
      }),
      /does not have a recognised firstrung publish role/
    );
    assert.equal(fake.calls.some(({ args }) => args[0] === "publish"), false);
  });
});

describe("release helpers", () => {
  it("enforces the release runtime without raising the deterministic CLI floor", () => {
    assert.throws(() => assertReleaseRuntime("22.18.9"), /requires Node >=22\.19\.0/);
    assert.doesNotThrow(() => assertReleaseRuntime("22.19.0"));
    assert.doesNotThrow(() => assertReleaseRuntime("23.0.0"));
  });

  it("orders packages after their internal dependencies and detects cycles", () => {
    const schema = releasePackage("@firstrung/schema", "packages/schema");
    const report = releasePackage("@firstrung/report", "packages/report", { "@firstrung/schema": VERSION });
    const cli = releasePackage("firstrung", "packages/cli", {
      "@firstrung/schema": VERSION,
      "@firstrung/report": VERSION
    });

    assert.deepEqual(orderReleasePackages([cli, report, schema]).map(({ name }) => name), [
      "@firstrung/schema",
      "@firstrung/report",
      "firstrung"
    ]);
    assert.throws(
      () => orderReleasePackages([
        releasePackage("@firstrung/a", "packages/a", { "@firstrung/b": VERSION }),
        releasePackage("@firstrung/b", "packages/b", { "@firstrung/a": VERSION })
      ]),
      /dependency cycle/
    );
  });

  it("derives a non-semver npm staging tag", () => {
    assert.equal(releaseStagingTag("0.1.0-alpha.2"), "release-0-1-0-alpha-2");
  });
});

function releaseFixture(options = {}) {
  const schema = releasePackage("@firstrung/schema", "packages/schema");
  const report = releasePackage("@firstrung/report", "packages/report", { "@firstrung/schema": VERSION });
  const cli = releasePackage(
    "firstrung",
    "packages/cli",
    { "@firstrung/schema": VERSION, "@firstrung/report": VERSION },
    outputContract()
  );
  const packages = [cli, report, schema];
  const publishedNames = options.publishedNames ?? new Set();
  const registry = new Map();

  for (const item of packages) {
    if (publishedNames.has(item.name)) registry.set(`${item.name}@${item.version}`, metadataFor(item));
  }

  return {
    packages,
    registry,
    preflight: {
      source: { head: HEAD, branch: "main", remote: "origin", mergeRef: "refs/heads/main" },
      packages,
      packageStates: packages.map((item) => ({
        name: item.name,
        version: item.version,
        status: publishedNames.has(item.name) ? "published" : "missing",
        ...(publishedNames.has(item.name) ? { gitHead: HEAD } : {})
      }))
    }
  };
}

function registryRunner(fixture, options = {}) {
  const calls = [];
  const tags = new Map(
    fixture.packages.map(({ name }) => [name, { alpha: "1.2.3-alpha.3", latest: "1.2.3-alpha.3" }])
  );
  let failureUsed = false;

  const run = async (command, args) => {
    calls.push({ command, args: [...args] });

    if (command !== "npm") return fail(`Unexpected command ${command}`);
    if (!failureUsed && options.failOnce?.({ command, args })) {
      failureUsed = true;
      return fail("simulated registry failure");
    }
    if (args[0] === "whoami") return ok("baziyer\n");
    if (args[0] === "org") return ok(`${JSON.stringify({ baziyer: options.role ?? "owner" })}\n`);
    if (args[0] === "run") return ok("");

    if (args[0] === "publish") {
      const workspace = args[2];
      const item = fixture.packages.find((candidate) => candidate.workspace === workspace);

      if (!item) return fail(`Unknown workspace ${workspace}`);
      fixture.registry.set(`${item.name}@${item.version}`, metadataFor(item));
      tags.get(item.name)[args.at(-1)] = item.version;
      return ok(`+ ${item.name}@${item.version}\n`);
    }

    if (args[0] === "view" && args[2] === "dist-tags") {
      return ok(`${JSON.stringify(tags.get(args[1]) ?? {})}\n`);
    }

    if (args[0] === "view") {
      const metadata = fixture.registry.get(args[1]);
      return metadata ? ok(`${JSON.stringify(metadata)}\n`) : fail(`npm error code E404\n${args[1]} is not in this registry`);
    }

    if (args[0] === "dist-tag" && args[1] === "add") {
      const at = args[2].lastIndexOf("@");
      const name = args[2].slice(0, at);
      const version = args[2].slice(at + 1);
      tags.get(name)[args[3]] = version;
      return ok("");
    }

    if (args[0] === "dist-tag" && args[1] === "rm") {
      delete tags.get(args[2])[args[3]];
      return ok("");
    }

    return fail(`Unexpected npm command: ${args.join(" ")}`);
  };

  return { calls, registry: fixture.registry, tags, run };
}

function releasePackage(name, workspace, internalDependencies = {}, firstrung) {
  return {
    name,
    workspace,
    version: VERSION,
    internalDependencies,
    ...(firstrung ? { outputContract: firstrung } : {})
  };
}

function metadataFor(item) {
  return {
    name: item.name,
    version: item.version,
    gitHead: HEAD,
    dependencies: item.internalDependencies,
    ...(item.outputContract ? { firstrung: item.outputContract } : {})
  };
}

function outputContract() {
  return {
    outputContract: "terminal-brief-v1",
    scanSchemaVersion: "firstrung.scan.v1",
    feedbackPacketSchemaVersion: "firstrung.feedback.v1",
    rulesetVersion: "2026-07-10.1",
    templateVersion: "2026-07-10.1",
    rendererVersion: "2026-07-10.1",
    defaultMaxNonblankLines: 5,
    defaultTargetMaxWords: 65
  };
}

function ok(stdout) {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr) {
  return { exitCode: 1, stdout: "", stderr };
}
