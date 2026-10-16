#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { run } from './cli.js';

process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: { isTTY: process.stdin.isTTY, readAll: () => text(process.stdin) },
  env: process.env,
});
