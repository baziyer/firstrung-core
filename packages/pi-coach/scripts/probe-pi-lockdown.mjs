#!/usr/bin/env node

import { runPiLockdownProbe } from "../dist/index.js";

try {
  const result = await runPiLockdownProbe();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`FirstRung Pi lockdown probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
