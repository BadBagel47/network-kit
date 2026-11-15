#!/usr/bin/env node
// Copy network-kit into a game (D-009): node scripts/vendor.mjs <target-dir> [--client-only]
// The target gets client/, server/, shared/, version.js and a VERSION file.
// Never edit the copy inside a game; fix network-kit and update instead.
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('usage: node scripts/vendor.mjs <target-dir> [--client-only]');
  process.exit(1);
}
const clientOnly = args.includes('--client-only');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const out = resolve(target);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const parts = clientOnly ? ['client', 'shared'] : ['client', 'server', 'shared'];
for (const part of parts) cpSync(join(root, 'src', part), join(out, part), { recursive: true });
cpSync(join(root, 'src', 'version.js'), join(out, 'version.js'));
writeFileSync(join(out, 'VERSION'), `${version}\n`);
writeFileSync(
  join(out, 'README.md'),
  `# network-kit ${version}\n\nA copy of https://github.com/BadBagel47/network-kit at v${version}.\n` +
    'Do not edit these files: fix network-kit first and update the copy (see its docs/INTEGRATION.md).\n',
);
console.log(`network-kit ${version} copied to ${out}${clientOnly ? ' (client only)' : ''}`);
