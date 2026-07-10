#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const requiredNodeMajor = 22;
const requiredNodeMinor = 6;
const cliPath = join(__dirname, "..", "dist", "index.js");

if (existsSync(cliPath)) {
  const result = spawnSync(process.execPath, [cliPath, "doctor", "--install-check"], {
    encoding: "utf8"
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  process.exit(0);
}

const issues = [];
const nodeIssue = checkNodeVersion();

if (nodeIssue) {
  issues.push(nodeIssue);
}

const npmIssue = checkExecutable("npm", "npm was not found on PATH. Install npm to use the published FirstRung CLI path.");

if (npmIssue) {
  issues.push(npmIssue);
}

const gitIssue = checkExecutable("git", "Git was not found on PATH. Install Git before running FirstRung scans.");

if (gitIssue) {
  issues.push(gitIssue);
}

if (issues.length > 0) {
  process.stderr.write(
    [
      "FirstRung install check found environment issue(s).",
      ...issues.map((issue) => `- ${issue}`),
      "Run firstrung doctor <repo> after fixing them."
    ].join("\n") + "\n"
  );
}

process.exit(0);

function checkNodeVersion() {
  const version = process.version.replace(/^v/, "");
  const [majorRaw, minorRaw] = version.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);

  if (Number.isNaN(major) || Number.isNaN(minor)) {
    return `Could not parse current Node.js version '${process.version}'. FirstRung expects Node.js >=${requiredNodeMajor}.${requiredNodeMinor}.`;
  }

  if (major > requiredNodeMajor || (major === requiredNodeMajor && minor >= requiredNodeMinor)) {
    return "";
  }

  return `Found Node.js ${version}. FirstRung expects Node.js >=${requiredNodeMajor}.${requiredNodeMinor}.`;
}

function checkExecutable(command, message) {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8"
  });

  if (result.error && result.error.code === "ENOENT") {
    return message;
  }

  if (result.status && result.status !== 0) {
    return `${command} was found but did not run cleanly.`;
  }

  return "";
}
