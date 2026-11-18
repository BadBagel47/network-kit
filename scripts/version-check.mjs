#!/usr/bin/env node
// Checks that the version is told the same everywhere and that CHANGELOG.md
// has a section for it, and warns when src/ has changed since the latest
// release while the version stayed the same (F-032). Run by the test workflow;
// the release workflow makes the same checks before it tags.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
const code = /VERSION = '([^']+)'/.exec(readFileSync('src/version.js', 'utf8'))?.[1];
const changelog = readFileSync('CHANGELOG.md', 'utf8');
let failed = false;
const error = (text) => {
  console.log(`::error::${text}`);
  failed = true;
};

if (pkg !== code) error(`package.json (${pkg}) and src/version.js (${code}) differ`);
if (!changelog.includes(`## ${pkg} (`)) error(`CHANGELOG.md has no section "## ${pkg} (…)"`);

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};
const tags = (git('tag', '--list', 'v*') ?? '').split('\n').filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.slice(1).split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const latest = tags.sort(newer).pop();
if (!latest) {
  console.log('No release tags here (fetch them for the src/ check).');
} else if (git('diff', '--quiet', latest, 'HEAD', '--', 'src') === null) {
  // git diff --quiet exits with 1 when something changed.
  if (`v${pkg}` === latest) {
    console.log(`::warning::src/ has changed since ${latest}, but the version is still ${pkg}: raise it (and add a CHANGELOG section) before the change is released`);
  } else {
    console.log(`src/ has changed since ${latest}; the version is ${pkg}.`);
  }
} else {
  console.log(`src/ is unchanged since ${latest}.`);
}
process.exit(failed ? 1 : 0);
