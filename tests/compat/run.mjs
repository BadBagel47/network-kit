#!/usr/bin/env node
// Compatibility check (D-021): the client of the previous release in the same
// MAJOR.MINOR line must still work against the current room logic, because
// games take PATCH versions without changing their own code. While the kit is
// 0.x a new MINOR may break, so there is nothing to check for an x.y.0.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const [major, minor, patch] = version.split('.').map(Number);
let tags = [];
try {
  tags = execFileSync('git', ['tag', '--list', `v${major}.${minor}.*`], { encoding: 'utf8' })
    .split('\n').map((t) => t.trim()).filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
} catch {
  tags = [];
}
const older = tags
  .map((t) => ({ tag: t, patch: Number(t.split('.')[2]) }))
  .filter((t) => t.patch < patch)
  .sort((a, b) => b.patch - a.patch)[0];

if (!older) {
  console.log(`compat: no earlier ${major}.${minor}.x release to check against ${version} (tags must be fetched for this check)`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'network-kit-compat-'));
try {
  const archive = execFileSync('git', ['archive', older.tag, 'src/client', 'src/shared', 'src/version.js'], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  console.log(`compat: the ${older.tag} client against the ${version} room logic`);
  const options = ['examples/demo/options.js', null];
  for (const file of options) {
    const args = ['src/smoke.mjs', '--client', join(dir, 'src/client/room.js'), ...(file ? ['--options', file] : [])];
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
