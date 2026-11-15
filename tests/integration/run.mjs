#!/usr/bin/env node
// Runs the integration tests against the demo Worker in wrangler dev.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { startWrangler } from '../support/wrangler.mjs';

const server = await startWrangler();
const files = readdirSync('tests/integration').filter((f) => f.endsWith('.test.mjs')).map((f) => `tests/integration/${f}`);
const only = process.argv.slice(2);
const tests = spawn(process.execPath, ['--test', '--test-concurrency=1', ...(only.length ? only : files)], {
  stdio: 'inherit',
  env: { ...process.env, NETWORK_KIT_URL: server.base },
});
const code = await new Promise((resolve) => tests.on('exit', resolve));
if (code !== 0) console.error('\n--- wrangler output ---\n', server.output().slice(-4000));
server.stop();
process.exit(code ?? 1);
